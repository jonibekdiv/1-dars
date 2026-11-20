/* Admin panel: every action updates the shared state, the overlay follows in real time.
   Several admins can work at once: each action is re-applied on top of the newest state
   if somebody else was faster, so nobody overwrites anybody. */
(() => {
  const { esc } = U;
  const $ = s => document.querySelector(s);
  const me = U.uid();
  let cfg = U.defConfig(), hist = U.normHist(), maps = U.normMaps(), ix = U.index(cfg);
  let live = U.defLive(1);          // what this admin sees (includes own not-yet-saved actions)
  let server = U.defLive(1);        // last state known to be saved
  let tab = 'live', sel = null, cur = null, kb = '', filter = '', undo = [], lastKillTeam = null, quiet = false;
  const queue = []; let pumping = false, pumpDone = Promise.resolve();
  /* phone mode (admin.html?m=1): only kills / knocks with big buttons — the normal panel is unchanged */
  const QS = new URLSearchParams(location.search), MOB = QS.get('m') === '1';
  if (MOB) document.body.classList.add('mob');
  const pref = (k, d) => { try { const v = localStorage.getItem('pgo:pref:' + k); return v === null ? d : v === '1'; } catch (e) { return d; } };
  let keepAtk = pref('keepAtk', true);             // the attacker stays selected after a kill (for multi-kills)
  const ui = { logEd: '', zone: 30, dist: 300, dmg: 500, c1: '', c2: '', team: '', team2: '', imin: 5, ih1: '', mapId: '', mapTeam: '', newAdmin: '', admins: null, newRoom: '', add: {} };
  let ME = null, ROOMS = [], started = false;     // nothing is drawn or saved before a tournament is opened

  /* ---------- persistence ---------- */
  let pubT = 0;
  const saveCfg = () => {
    cfg = U.normConfig(cfg); cfg._w = me; ix = U.index(cfg); Store.set('config', cfg);
    clearTimeout(pubT); pubT = setTimeout(() => Store.set('pub', U.publicConfig(cfg)), 1500);   // slim copy for the public page
  };
  /* Results are changed with a function that runs on the NEWEST saved copy and is saved only if nobody
     changed them in between (like the live match) — a second tab or phone can never wipe finished matches. */
  let histQ = Promise.resolve();
  const wait = ms => new Promise(r => setTimeout(r, ms));
  function histAct(fn) {
    fn(hist); render();                                          // on screen at once
    histQ = histQ.then(async () => {
      for (;;) {
        const r0 = await Store.loadStrict('history');
        if (!r0.ok) { await wait(1500); continue; }              // could not read: never write a guess
        const base = U.normHist(U.clone(r0.data) || {}), s = base._s || 0;
        fn(base); base._s = s + 1; base._w = me;
        const r = await Store.cas('history', s, base);
        if (r.ok) { hist = base; render(); return; }
        if (!r.current) await wait(1500);                        // network / permission: try again
      }
    });
    return histQ;
  }
  const toTrash = (h, list) => { h.trash = list.map(m => Object.assign({}, m, { deletedAt: Date.now() })).concat(h.trash).slice(0, 40); };
  const saveMaps = () => { maps._w = me; Store.set('maps', maps); };
  const SH = () => U.stageHist(cfg, hist);

  const P = pid => live.players[pid] || (live.players[pid] = { k: 0, kn: 0, dmg: 0, st: 'a' });
  const teamOf = pid => ix.p[pid] && ix.p[pid].t;
  const elapsed = () => live.startedAt ? Math.round((Date.now() - live.startedAt) / 1000) : 0;
  const gridTeams = () => cfg.teams.filter(t => U.inStage(cfg, t));

  /* ---------- actions on the live match ---------- */
  function run(fn) { lastKillTeam = null; quiet = !!fn.quiet; fn(); settle(); quiet = false; }
  function diff(b, a) {            // what an action changed, so that exactly this can be undone later
    const p = { players: {}, teams: {}, top: {}, ban: [], log: [] };
    const J = JSON.stringify;
    new Set(Object.keys(b.players).concat(Object.keys(a.players))).forEach(id => { if (J(b.players[id]) !== J(a.players[id])) p.players[id] = b.players[id] || null; });
    new Set(Object.keys(b.teams).concat(Object.keys(a.teams))).forEach(id => { if (J(b.teams[id]) !== J(a.teams[id])) p.teams[id] = b.teams[id] || null; });
    ['startedAt', 'zone', 'matchNo', 'map', 'show'].forEach(k => { if (J(b[k]) !== J(a[k])) p.top[k] = b[k] === undefined ? null : b[k]; });
    const had = new Set(b.banners.map(x => x.id)); p.ban = a.banners.filter(x => !had.has(x.id)).map(x => x.id);
    const hadL = new Set(b.log.map(J)); p.log = a.log.map(J).filter(x => !hadL.has(x));
    return p;
  }
  function act(fn, noUndo) {
    const before = U.clone(live);
    run(fn);
    if (!noUndo) { undo.push(diff(before, live)); if (undo.length > 80) undo.shift(); }
    queue.push(fn); pump(); render();
  }
  function pump() {
    if (pumping) return;
    pumping = true;
    pumpDone = (async () => {
      while (queue.length) {
        const fn = queue[0], keep = live;
        live = U.normLive(U.clone(server)); run(fn);           // apply the action on the newest saved state
        const cand = live; live = keep;
        cand._s = (server._s || 0) + 1; cand._w = me;
        const r = await Store.cas('live', server._s || 0, cand);
        if (r.ok) { server = cand; queue.shift(); }
        else if (r.current) server = U.normLive(r.current);     // another admin was faster: retry on top of their change
        else await new Promise(res => setTimeout(res, 1500));   // network / permission problem: keep trying
      }
      live = U.normLive(U.clone(server)); pumping = false; render();
    })();
  }
  function log(e) {
    if (quiet) return;
    live.log.push(Object.assign({ id: U.uid(), t: elapsed() }, e));
    if (live.log.length > 14) live.log.splice(0, live.log.length - 14);
  }
  function banner(b) {
    if (quiet) return;
    live.banners.push(Object.assign({ id: U.uid(), ts: Date.now() }, b));
    if (live.banners.length > 12) live.banners.splice(0, live.banners.length - 12);
  }
  function undoLast() {
    const p = undo.pop(); if (!p) return;
    const fn = () => {
      Object.keys(p.players).forEach(id => { if (p.players[id]) live.players[id] = U.clone(p.players[id]); else delete live.players[id]; });
      Object.keys(p.teams).forEach(id => { if (p.teams[id]) live.teams[id] = U.clone(p.teams[id]); else delete live.teams[id]; });
      Object.keys(p.top).forEach(k => { live[k] = U.clone(p.top[k]); });
      live.banners = live.banners.filter(x => !p.ban.includes(x.id));
      live.log = live.log.filter(x => !p.log.includes(JSON.stringify(x)));
    };
    fn.quiet = true;
    act(fn, true);
  }

  /* Team placements follow automatically from player statuses */
  function settle() {
    const teams = U.teams(cfg);
    const all = teams.map(t => ({ t, tl: U.teamLive(cfg, live, t), rec: live.teams[t.id] || (live.teams[t.id] = {}) }));
    // a team that is alive again (correction) loses its automatic placement
    all.forEach(x => { if (x.rec.place && !x.rec.m && !x.tl.out && x.rec.place !== 1) delete x.rec.place; });
    all.filter(x => x.tl.out && !x.rec.place).forEach(x => {
      x.rec.place = all.filter(y => !y.rec.place).length;
      log({ k: 'out', tid: x.t.id, place: x.rec.place });
      if (cfg.auto.teamElim) banner({ type: 'teamelim', tid: x.t.id, by: lastKillTeam && lastKillTeam !== x.t.id ? lastKillTeam : null, place: x.rec.place });
    });
    // automatic winner: the single team left standing
    all.forEach(x => { if (x.rec.place === 1 && !x.rec.m && (x.tl.out || all.some(y => y !== x && !y.rec.place))) delete x.rec.place; });
    const left = all.filter(x => !x.rec.place);
    if (left.length === 1 && teams.length > 1 && !left[0].tl.out && !all.some(x => x.rec.place === 1)) left[0].rec.place = 1;
  }

  /* ---------- kill / knock logic ---------- */
  function die(pid, credit, cascade) {
    const v = P(pid), knocker = v.by;
    v.st = 'd'; v.dt = elapsed(); delete v.by;
    log({ k: 'kill', a: credit && ix.p[credit] ? credit : null, v: pid });
    if (!credit || !ix.p[credit]) return;
    const A = P(credit), at = teamOf(credit);
    A.k++; if (!cascade) lastKillTeam = at.id;                      // a team is closed by whoever fired the LAST shot, not by an older knock
    const totalKills = Object.values(live.players).reduce((s, p) => s + (p.k || 0), 0);
    const teamKills = at.players.reduce((s, p) => s + (P(p.id).k || 0), 0);
    if (cfg.auto.firstBlood && totalKills === 1) banner({ type: 'firstblood', pid: credit });
    if (cfg.auto.stealer && knocker && teamOf(knocker) && teamOf(knocker).id !== at.id) banner({ type: 'stealer', pid: credit });
    if (+cfg.auto.rampage && A.k === +cfg.auto.rampage) banner({ type: 'rampage', pid: credit, v: A.k });
    if (+cfg.auto.domination && teamKills === +cfg.auto.domination) banner({ type: 'domination', tid: at.id, v: teamKills });
  }
  /* PUBG rule: when nobody on a team is standing, knocked players die at once (kill goes to who knocked them) */
  function wipeCheck(t) {
    if (t.players.some(p => P(p.id).st === 'a')) return;
    t.players.forEach(p => { const s = P(p.id); if (s.st === 'k') die(p.id, s.by, true); });
  }
  const attackerFor = (atk, vt) => (atk && teamOf(atk) && teamOf(atk).id !== vt.id) ? atk : null;
  function knock(pid) {
    const atk = sel; if (!ix.p[pid]) return;
    act(() => {
      const v = P(pid), vt = teamOf(pid);
      if (!live.startedAt) live.startedAt = Date.now();
      if (v.st === 'd') return;
      if (v.st === 'k') { v.st = 'a'; delete v.by; log({ k: 'rev', v: pid }); return; }     // revived by a teammate
      v.st = 'k';
      const a = attackerFor(atk, vt);
      if (a) { v.by = a; P(a).kn++; } else delete v.by;
      log({ k: 'knock', a, v: pid });
      lastKillTeam = a ? teamOf(a).id : null;
      wipeCheck(vt);
    });
    dropAtk(atk);
  }
  function kill(pid) {
    const atk = sel; if (!ix.p[pid]) return;
    act(() => {
      const v = P(pid), vt = teamOf(pid);
      if (!live.startedAt) live.startedAt = Date.now();
      if (v.st === 'd') { unkill(pid); return; }                  // a mistake: the kill is taken back
      die(pid, attackerFor(atk, vt) || v.by);
      wipeCheck(vt);
    });
    dropAtk(atk);
  }
  /* An event read from the screen: attacker -> victim, or a victim alone (zone, fall, …: a = null).
     Knock or kill follows from the game rules, not from the icon:
       - victim already knocked  -> killed; the kill goes to who finished him, and when nobody did
         (the zone finished him / he bled out) to who knocked him
       - victim standing, a teammate still up -> knocked (by the attacker, or by the zone: nobody)
       - victim standing and alone (last one) -> killed outright
     Weapon, vehicle, grenade, fire, knife: all the same, only the names matter. */
  function autoKind(a, v) {
    if (!ix.p[v]) return null;
    if (a && (!ix.p[a] || teamOf(a).id === teamOf(v).id)) return null;
    const vs = P(v).st, vt = teamOf(v); if (vs === 'd') return null;
    return vs === 'k' || !vt.players.some(p => p.id !== v && P(p.id).st === 'a') ? 'kill' : 'knock';
  }
  function autoEvent(a, v) {
    const kind = autoKind(a, v); if (!kind) return null;
    const vt = teamOf(v);
    act(() => {
      const x = P(v); if (!live.startedAt) live.startedAt = Date.now();
      if (x.st === 'd') return;
      if (x.st === 'k' || kind === 'kill') {
        const credit = a || x.by || null;
        die(v, credit);                                              // sets "closed by" to the credited team
        if (!credit) lastKillTeam = null;
      } else {
        x.st = 'k'; if (a) { x.by = a; P(a).kn++; } else delete x.by;
        log({ k: 'knock', a: a || null, v });
        lastKillTeam = a ? teamOf(a).id : null;
      }
      wipeCheck(vt);
    });
    return kind;
  }
  window.AdminAPI = {
    roster: () => gridTeams().flatMap(t => t.players.map(p => ({ pid: p.id, tid: t.id, tag: t.tag, name: p.name, nick: p.nick || '', st: (live.players[p.id] || {}).st || 'a' }))),
    label: pid => ix.p[pid] ? ix.p[pid].t.tag + ' · ' + ix.p[pid].p.name : '?',
    kind: autoKind, event: autoEvent, render: () => render(), room: () => Store.room
  };
  /* back to alive: the killer loses that kill and the log line goes (used by ☠ on a dead player and by the log editor) */
  function unkill(pid, entryId) {
    const v = P(pid);
    const e = entryId ? live.log.find(x => x.id === entryId) : live.log.slice().reverse().find(x => x.k === 'kill' && x.v === pid);
    if (e && e.a && live.players[e.a]) P(e.a).k = Math.max(0, (P(e.a).k || 0) - 1);
    if (e) live.log = live.log.filter(x => x !== e);
    v.st = 'a'; delete v.dt; delete v.by;
  }
  function dropAtk(atk) { if (atk && !keepAtk && sel === atk) { sel = null; render(); } }
  /* the whole team out at once (zone, left the game): no kill credit, knocked players count for who knocked them */
  function wipe(tid) {
    const t = ix.t[tid]; if (!t) return;
    act(() => {
      if (!live.startedAt) live.startedAt = Date.now();
      t.players.forEach(p => { if (P(p.id).st === 'a') die(p.id, null); });
      wipeCheck(t);
    });
  }
  /* log editor: another attacker (or the zone) for a kill / knock, or delete the line */
  function logFix(id, na) {
    act(() => {
      const e = live.log.find(x => x.id === id); if (!e || (e.k !== 'kill' && e.k !== 'knock') || e.a === na) return;
      const f = e.k === 'kill' ? 'k' : 'kn', v = P(e.v);
      if (e.a && live.players[e.a]) P(e.a)[f] = Math.max(0, (P(e.a)[f] || 0) - 1);
      if (na) P(na)[f] = (P(na)[f] || 0) + 1;
      if (e.k === 'knock' && v.st === 'k') { if (na) v.by = na; else delete v.by; }
      e.a = na;
    });
  }
  function logDel(id) {
    act(() => {
      const e = live.log.find(x => x.id === id); if (!e) return;
      if (e.k === 'kill') { if (P(e.v).st === 'd') unkill(e.v, id); else live.log = live.log.filter(x => x !== e); return; }
      if (e.k === 'knock') {
        if (e.a && live.players[e.a]) P(e.a).kn = Math.max(0, (P(e.a).kn || 0) - 1);
        const v = P(e.v); if (v.st === 'k') { v.st = 'a'; delete v.by; }
      }
      if (e.k === 'rev') { const v = P(e.v); if (v.st === 'a') v.st = 'k'; }
      live.log = live.log.filter(x => x !== e);
    });
  }

  /* ---------- images ---------- */
  function readImage(file, max, q) {
    return new Promise(res => {
      const im = new Image();
      im.onload = () => {
        const s = Math.min(1, max / Math.max(im.width, im.height));
        const c = document.createElement('canvas');
        c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(im.src);
        res(c.toDataURL('image/webp', q || .82));
      };
      im.onerror = () => res('');
      im.src = URL.createObjectURL(file);
    });
  }
  const up = (src, act, id, label) => `<span class="up" title="${label || 'Rasm yuklash'}">${src ? `<img src="${esc(src)}">` : '+'}<input type="file" accept="image/*" data-c="${act}" data-id="${id || ''}"></span>`;

  /* ---------- LIVE tab ---------- */
  function gridHtml() {
    const f = filter.trim().toLowerCase();
    return gridTeams().map((t, n) => {
      const tl = U.teamLive(cfg, live, t);
      const hit = !f || (t.tag + ' ' + t.name + ' ' + t.players.map(p => p.name).join(' ')).toLowerCase().includes(f);
      return `<div class="tc ${tl.out ? 'out' : ''} ${hit ? '' : 'dim'}"><div class="hd"><i class="no">${String(n + 1).padStart(2, '0')}</i>${t.logo ? `<img src="${esc(t.logo)}">` : ''}<span>${esc(t.tag)}</span>` +
        (tl.place ? `<span class="pl ${tl.place === 1 ? 'w' : ''}">#${tl.place}</span>` : '') + `<span class="el">${tl.elims}</span>${tl.out ? '' : `<button class="wipe" data-a="wipe" data-id="${t.id}" title="Butun jamoa yopildi (zona / chiqib ketdi)">☠ Hammasi</button>`}</div>` +
        tl.pl.map((p, i) => `<div class="pr ${p.st} ${cur === p.id ? 'cur' : ''}"><button class="nm ${sel === p.id ? 'sel' : ''}" data-a="sel" data-id="${p.id}"><i>${i + 1}</i>${esc(p.name)}</button>` +
          `<button class="mini" data-a="km" data-id="${p.id}">−</button><span class="k">${p.k || 0}</span><button class="mini" data-a="kp" data-id="${p.id}">+</button>` +
          `<button class="bk ${p.st === 'k' ? 'on' : ''}" data-a="knock" data-id="${p.id}" title="${p.st === 'k' ? 'Turg\'izildi (revive)' : 'Nok'}">${p.st === 'k' ? '⤴' : 'N'}</button><button class="bd ${p.st === 'd' ? 'on' : ''}" data-a="kill" data-id="${p.id}" title="O'ldi">☠</button></div>`).join('') + '</div>';
    }).join('') || '<div class="box">Jamoalar yo\'q. "Jamoalar" bo\'limida qo\'shing.</div>';
  }
  function atkHtml() {
    const se = sel && ix.p[sel], ce = cur && ix.p[cur];
    const kbd = kb || ce ? `<span class="kbd">${ce ? `⌨ <b>${esc(ce.t.tag)} · ${esc(ce.p.name)}</b> <u>A</u> <u>K</u> <u>N</u>` : `⌨ <b>${esc(kb)}</b>…`}</span>` : '';
    return (se ? `<span class="hint">HUJUMCHI</span><b>${esc(se.t.tag)} · ${esc(se.p.name)}</b><button data-a="unsel">✕ Esc</button>`
      : '<span class="hint">Avval <b>hujumchi ismi</b>, keyin qurbonning <b>N</b> / <b>☠</b>. Tanlanmasa — zona.</span>') + kbd;
  }
  /* the last attackers, one tap to pick again */
  function recHtml() {
    const seen = [], L = live.log.slice().reverse();
    for (const e of L) { if (e.a && ix.p[e.a] && !seen.includes(e.a) && P(e.a).st !== 'd') seen.push(e.a); if (seen.length >= 5) break; }
    return `<span class="hint">${seen.length ? 'Oxirgi:' : 'Oxirgi hujumchilar shu yerda chiqadi'}</span>` +
      seen.map(id => `<button class="chip ${sel === id ? 'on' : ''}" data-a="sel" data-id="${id}">${esc(ix.p[id].t.tag)} · ${esc(ix.p[id].p.name)} <b>${P(id).k || 0}</b></button>`).join('') +
      `<button class="keep ${keepAtk ? 'on' : ''}" data-a="keepAtk" title="Yoqilgan: hujumchi kill'dan keyin ham tanlangan qoladi (ketma-ket killar uchun). O'chiq: har kill'dan keyin o'zi tozalanadi.">📌 ${keepAtk ? 'Hujumchi qoladi' : 'Hujumchi tozalanadi'}</button>`;
  }
  function logHtml() {
    const nm = pid => ix.p[pid] ? `${esc(ix.p[pid].t.tag)} ${esc(ix.p[pid].p.name)}` : '?';
    const L = live.log.slice().reverse();
    if (!L.length) return '<p class="hint">Hali harakat yo\'q.</p>';
    const line = e => e.k === 'out' ? `<b>${esc((ix.t[e.tid] || {}).tag || '?')}</b> yopildi · #${e.place}`
      : e.k === 'rev' ? `<b>⤴</b> ${nm(e.v)} turg'izildi`
      : e.k === 'knock' ? `${e.a ? nm(e.a) : 'Zona'} <b>N</b> ${nm(e.v)}` : `${e.a ? nm(e.a) : 'Zona'} <b>☠</b> ${nm(e.v)}`;
    return L.map(e => {
      const can = e.id && e.k !== 'out', open = can && ui.logEd === e.id;
      const vt = ix.p[e.v] && ix.p[e.v].t;
      const opts = open && e.k !== 'rev' ? `<option value="">Zona / hech kim</option>` + gridTeams().filter(t => !vt || t.id !== vt.id).map(t => `<optgroup label="${esc(t.tag)}">${t.players.map(p => `<option value="${p.id}" ${e.a === p.id ? 'selected' : ''}>${esc(t.tag)} · ${esc(p.name)}</option>`).join('')}</optgroup>`).join('') : '';
      return `<div class="lg ${e.k} ${can ? 'ed' : ''} ${open ? 'open' : ''}" ${can ? `data-a="logEd" data-id="${e.id}"` : ''}><i>${U.mmss(e.t)}</i>${line(e)}${can ? '<s>✎</s>' : ''}</div>` +
        (open ? `<div class="lged">${e.k !== 'rev' ? `<label>Kim ${e.k === 'kill' ? 'o\'ldirdi' : 'nok qildi'}?<select data-le="${e.id}">${opts}</select></label>` : ''}<div class="row"><button class="dng" data-a="logDel" data-id="${e.id}">🗑 O'chirish${e.k === 'kill' ? ' (o\'yinchi tiriladi)' : e.k === 'knock' ? ' (nok bekor)' : ''}</button><button data-a="logEd" data-id="">Yopish</button></div></div>` : '');
    }).join('');
  }
  const sceneKey = sh => !sh.scene ? '' : sh.scene + (sh.scene === 'mvp1' ? ':' + ((sh.mvp || {}).scope || '') : sh.scene === 'info' ? ':' + ((sh.info || {}).kind || '') : '');
  /* ---------- music ---------- */
  const MU = () => Object.assign({ id: null, playing: false, vol: 70, loop: false, mode: 'list', cmd: null }, live.show.music);
  const MM = [['champion', '🏆 Chempion'], ['soon', 'Tez orada'], ['break', 'Tanaffus'], ['next', 'Keyingi match'], ['results', 'Match natijasi'], ['overall', 'Umumiy reyting'], ['mvp', 'MVP / Top fraggers'], ['team', 'Jamoa statistikasi'], ['vs', 'A vs B'], ['map', 'Xarita (drop)']];
  function musicHtml() {
    const m = MU(), cur = U.track(cfg, m.id), auto = live.show.autoMusic !== false;
    return `<div class="box music"><h3>🎵 Musiqa (OBS'da chalinadi)</h3>
      <div class="now ${m.playing ? 'on' : ''}"><span class="eq"><i></i><i></i><i></i></span><b>${cur ? esc(cur.name) : 'Hech narsa tanlanmagan'}</b><small>${cur ? (m.playing ? 'chalinmoqda' : 'pauza') : ''}</small></div>
      <div class="g3" style="margin:8px 0"><button data-a="muPrev">⏮</button><button class="${m.playing ? '' : 'pri'}" data-a="muToggle">${m.playing ? '⏸ Pauza' : '▶ Chalish'}</button><button data-a="muNext">⏭</button></div>
      <div class="row"><span>🔈</span><input type="range" min="0" max="100" step="5" data-mu="vol" value="${m.vol}" style="flex:1"><b style="width:38px;text-align:right">${m.vol}%</b></div>
      <div class="row"><button class="${m.mode === 'one' ? 'on' : ''}" data-a="muMode" data-v="one">🔂 Bitta qo'shiq</button><button class="${m.mode === 'list' ? 'on' : ''}" data-a="muMode" data-v="list">🔁 Ro'yxat bo'yicha</button><button data-a="muStop" ${m.id ? '' : 'disabled'}>⏹ To'xtatish</button></div>
      <div class="tracks">${U.tracks(cfg).map((t, i) => `<div class="trk ${t.id === m.id ? 'cur' : ''} ${t.builtin ? 'bi' : ''}"><button class="pl" data-a="muPlay" data-id="${t.id}">${t.id === m.id && m.playing ? '⏸' : '▶'}</button><span>${i + 1}. ${esc(t.name)}</span>${t.builtin ? '' : `<button class="dng" data-a="muDel" data-id="${t.id}" title="O'chirish">✕</button>`}</div>`).join('')}</div>
      <div class="row automu"><button class="${auto ? 'on' : ''}" data-a="autoMu" style="flex:1">${auto ? '🎬 Sahna musiqasi: YOQILGAN' : '🎬 Sahna musiqasi: O\'CHIQ'}</button><button data-a="mmOpen">${ui.mmOpen ? '▲' : '⚙ Sozlash'}</button></div>
      ${m.auto ? `<p class="hint" style="margin:4px 0 0">▶ Hozir sahna musiqasi chalinyapti — sahna yopilsa ${m.prev && m.prev.playing ? 'oldingi qo\'shiq davom etadi' : 'to\'xtaydi'}.</p>` : ''}
      ${ui.mmOpen ? `<div class="mmap">${MM.map(([k, l]) => `<label>${l}<select data-mm="${k}"><option value="">— musiqasiz —</option>${U.tracks(cfg).map(t => `<option value="${t.id}" ${cfg.musicMap[k] === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>`).join('')}
        <p class="hint">Sahna ochilganda shu musiqa o'zi boshlanadi, sahna yopilganda to'xtaydi (oldin chalinayotgan qo'shiq bo'lsa — u davom etadi). Chempion fanfarasi bir marta chalinadi, qolganlari aylanadi.</p></div>` : ''}
      <label class="filebtn" style="margin-top:8px">${ui.uploading ? '⏳ Yuklanmoqda…' : '⬆ Musiqa yuklash (MP3, M4A, WAV, OGG · 30 MB gacha)'}<input type="file" accept="audio/*" multiple data-c="music" ${ui.uploading ? 'disabled' : ''}></label>
      <p class="hint">OBS'da overlay manbasi sozlamasida <b>"Control audio via OBS"</b> ni belgilang — ovoz OBS mikserida chiqadi.</p></div>`;
  }
  /* ---------- commentator camera frame ---------- */
  const CAMSZ = { s: [384, 216], m: [480, 270], l: [576, 324] };
  function camBox(c) {
    const [w, h] = CAMSZ[c.size] || CAMSZ.m;
    return { w, h, x: c.pos === 'tr' || c.pos === 'br' ? 1920 - 40 - w : 40, y: c.pos === 'bl' || c.pos === 'br' ? 1080 - 60 - h : 40 };
  }
  function camHtml() {
    const c = live.show.cam, b = camBox(c);
    const opt = (k, v, l) => `<button class="${c[k] === v ? 'on' : ''}" data-a="cam" data-k="${k}" data-v="${v}">${l}</button>`;
    return `<div class="box cam"><h3>🎥 Sharhlovchi kamerasi</h3>
      <button class="${c.on ? 'on' : 'pri'}" data-a="cam" data-k="on" data-v="${c.on ? '' : '1'}" style="width:100%;margin-bottom:8px">${c.on ? '👁 Ekranda — yashirish' : '🎥 Kamera ramkasini chiqarish'}</button>
      <div class="g4">${opt('pos', 'tl', '↖ Chap tepa')}${opt('pos', 'tr', '↗ O\'ng tepa')}${opt('pos', 'bl', '↙ Chap past')}${opt('pos', 'br', '↘ O\'ng past')}</div>
      <div class="g3" style="margin:6px 0">${opt('size', 's', 'Kichik')}${opt('size', 'm', 'O\'rta')}${opt('size', 'l', 'Katta')}</div>
      <div class="row"><input data-cam="name" placeholder="Ism (masalan ASADBEK)" value="${esc(c.name)}"><input data-cam="sub" placeholder="Pastki yozuv (SHARHLOVCHI)" value="${esc(c.sub)}"></div>
      <p class="hint">OBS'da kamerangizni overlay <b>ostiga</b> qo'ying: <b>X ${b.x}, Y ${b.y}, ${b.w}×${b.h}</b> (1920×1080 sahnada). Ramka o'rtasi shaffof — yuz ko'rinadi.</p></div>`;
  }
  function sideHtml() {
    const se = sel && ix.p[sel], sh = live.show, now = sceneKey(sh);
    const tg = (k, l) => `<button class="${sh[k] ? 'on' : ''}" data-a="show" data-v="${k}">${l}</button>`;
    const sc = (k, l, extra, key) => `<button class="${now === (key || k) ? 'on' : ''}" data-a="scene" data-v="${k}" ${extra || ''}>${l}</button>`;
    const dis = se ? '' : 'disabled';
    const winner = cfg.teams.find(t => (live.teams[t.id] || {}).place === 1);
    const tid = ui.team || (winner && winner.id) || (se && se.t.id) || '';
    const opts = v => gridTeams().map(t => `<option value="${t.id}" ${t.id === v ? 'selected' : ''}>${esc(t.tag)} — ${esc(t.name)}</option>`).join('');
    return `${typeof AutoKill !== 'undefined' && !MOB ? AutoKill.html() : ''}<div class="box"><h3>Ekranda ko'rsatish</h3><div class="g2">${tg('ranking', 'Reyting')}${tg('lower', 'Pastki banner')}${tg('wwcd', 'Final jamoalar')}${tg('sound', sh.sound ? '🔊 Ovoz yoqilgan' : '🔇 Ovoz o\'chiq')}</div></div>
    ${musicHtml()}
    ${camHtml()}
    <div class="box"><h3>Zona</h3><div class="row"><input type="number" data-u="zone" value="${ui.zone}" style="max-width:80px"><span>sek</span><button class="pri" data-a="zone">Boshlash</button><button data-a="zoneOff">To'xtatish</button></div>
      <p class="hint">Oxirgi ${cfg.zoneShowAt} soniyada "CIRCLE CLOSING IN" chiqadi.</p></div>
    <div class="box"><h3>O'yinchi bannerlari ${se ? '' : '(avval o\'yinchini tanlang)'}</h3>
      <div class="g2" style="margin-bottom:6px"><button ${dis} data-a="bn" data-v="airdrop">Airdrop looted</button><button ${dis} data-a="bn" data-v="stealer">Elim stealer</button>
      <button ${dis} data-a="bn" data-v="rampage">Rampage</button><button ${dis} data-a="bn" data-v="domination">Domination (jamoa)</button></div>
      <div class="inl"><input type="number" data-u="dist" value="${ui.dist}"><button ${dis} data-a="bn" data-v="sharp">Sharpshooter (metr)</button></div>
      <div class="inl"><input type="number" data-u="dmg" value="${ui.dmg}"><button ${dis} data-a="bn" data-v="damage">Damage</button></div>
      <div class="row"><input data-u="c1" placeholder="1-qator" value="${esc(ui.c1)}"><input data-u="c2" placeholder="2-qator" value="${esc(ui.c2)}"></div>
      <button ${dis} data-a="bn" data-v="custom" style="width:100%">O'z matnim</button></div>
    <div class="box"><h3>To'liq ekran sahnalar</h3>
      <div class="g2" style="margin-bottom:8px">${sc('results', 'Match natijasi')}${sc('overall', 'Umumiy reyting')}${sc('mvp', 'Top fraggers')}${sc('map', 'Xarita (drop)')}
        ${sc('mvp1', 'Match MVP', 'data-s="match"', 'mvp1:match')}${sc('mvp1', 'Turnir MVP', 'data-s="all"', 'mvp1:all')}</div>
      ${U.pages(U.teams(cfg).length) > 1 ? `<div class="row pages"><span class="hint" style="margin:0">Jadval varog'i:</span>${Array.from({ length: U.pages(U.teams(cfg).length) }, (_, i) => `<button class="${(+sh.page || 0) === i ? 'on' : ''}" data-a="page" data-v="${i}">${i + 1}-varoq <small>(#${i * U.PER_PAGE + 1}–${Math.min(U.teams(cfg).length, (i + 1) * U.PER_PAGE)})</small></button>`).join('')}</div>` : ''}
      <button ${dis} data-a="scene" data-v="mvp1" data-s="pick" class="${now === 'mvp1:pick' ? 'on' : ''}" style="width:100%;margin-bottom:8px">MVP: tanlangan o'yinchi</button>
      <div class="row"><select data-u="team" style="flex:1"><option value="">Jamoa A…</option>${opts(tid)}</select><select data-u="team2" style="flex:1"><option value="">Jamoa B…</option>${opts(ui.team2)}</select></div>
      <div class="g3" style="margin-bottom:8px">${sc('team', 'Statistika')}${sc('champion', '🏆 Chempion')}${sc('vs', 'A vs B')}</div>
      <h3>Tanaffus sahnalari</h3>
      <div class="row"><input type="number" data-u="imin" value="${ui.imin}" style="max-width:70px" min="0"><span>daqiqa sanoq</span><input data-u="ih1" placeholder="O'z sarlavham (ixtiyoriy)" value="${esc(ui.ih1)}"></div>
      <div class="g3" style="margin-bottom:8px">${sc('info', 'Tez orada', 'data-k="soon"', 'info:soon')}${sc('info', 'Keyingi match', 'data-k="next"', 'info:next')}${sc('info', 'Tanaffus', 'data-k="break"', 'info:break')}</div>
      <button data-a="scene" data-v="" class="${sh.scene ? 'pri' : ''}" style="width:100%">✕ Sahnani yopish</button></div>
    <div class="box"><h3>Oxirgi harakatlar</h3><div class="log">${logHtml()}</div></div>
    <div class="box"><h3>Match</h3>
      <div class="row"><label>№<input type="number" data-l="matchNo" value="${live.matchNo}" style="width:60px"></label><label style="flex:1">Xarita<input data-l="map" value="${esc(live.map)}" list="maplist"><datalist id="maplist">${maps.list.map(m => `<option value="${esc(m.name)}">`).join('')}</datalist></label></div>
      <div class="g2"><button data-a="timer" class="${live.startedAt ? '' : 'pri'}">${live.startedAt ? 'Taymerni qayta boshlash' : '▶ Match boshlandi'}</button><button data-a="finish" class="pri">✔ Matchni yakunlash</button></div>
      <p class="hint">Bosqich: <b>${esc(cfg.stage)}</b>. Yakunlashda natija saqlanadi va yangi match ochiladi.</p></div>
    <details class="box"><summary>⌨ Klaviatura tugmalari</summary><p class="hint"><b>2 raqam</b> — jamoa (kartadagi son), <b>1 raqam</b> — o'yinchi. Masalan <b>032</b> = 3-jamoa 2-o'yinchi.<br>
      <b>A</b> yoki <b>Enter</b> — hujumchi qilib tanlash · <b>K</b> — kill · <b>N</b> — nok · <b>Backspace</b> — raqamni tozalash · <b>Esc</b> — hujumchini bekor qilish · <b>Ctrl+Z</b> — bekor qilish.<br>
      Misol: <b>011 A 032 K</b> — 1-jamoa 1-o'yinchi 3-jamoa 2-o'yinchini o'ldirdi.</p></details>`;
  }

  /* ---------- TEAMS tab ---------- */
  function teamsHtml() {
    return `<div class="box"><div class="row"><button class="pri" data-a="addTeam">+ Jamoa qo'shish</button><button data-a="demo">Namuna (16 jamoa)</button><span class="hint">Jami: ${cfg.teams.length} jamoa. Logo va rasmlar avtomatik kichraytiriladi.</span></div>
      <details><summary>Ro'yxatdan tez kiritish</summary><p class="hint">Har qatorga: TEG, Jamoa nomi, davlat kodi (uz, tr, id…), o'yinchi1, o'yinchi2, o'yinchi3, o'yinchi4</p>
      <textarea id="bulk" placeholder="NOT, Old Not, uz, MOLODOY, RAMZES, RUZEN, MUZAFCIK"></textarea><button data-a="bulk">Qo'shish</button></details></div>
    <div class="te">${cfg.teams.map(t => `<div class="box"><div class="th">${up(t.logo, 'tlogo', t.id, 'Logo')}
      <input data-t="tag" data-id="${t.id}" value="${esc(t.tag)}" placeholder="TEG" maxlength="6"><input data-t="name" data-id="${t.id}" value="${esc(t.name)}" placeholder="Jamoa nomi">
      <input data-t="flag" data-id="${t.id}" value="${esc(t.flag || '')}" placeholder="uz" maxlength="2" title="Davlat kodi"><button class="dng" data-a="delTeam" data-id="${t.id}">✕</button></div>
      ${t.players.map(p => `<div class="pe">${up(p.photo, 'pphoto', p.id, 'Foto')}<input data-p="name" data-id="${p.id}" value="${esc(p.name)}" placeholder="O'yinchi niki"><button class="dng" data-a="delPl" data-id="${p.id}">✕</button></div>`).join('')}
      <button data-a="addPl" data-id="${t.id}">+ O'yinchi</button></div>`).join('')}</div>`;
  }

  /* ---------- MAP tab ---------- */
  const curMap = () => maps.list.find(m => m.id === ui.mapId) || maps.list.find(m => m.name === live.map) || maps.list[0];
  function mapHtml() {
    const m = curMap();
    const teams = gridTeams().filter(t => t.players.length);
    return `<div class="box"><div class="row">${maps.list.map(x => `<button class="${m && x.id === m.id ? 'on' : ''}" data-a="mapPick" data-id="${x.id}">${esc(x.name)}</button>`).join('')}<button class="pri" data-a="mapAdd">+ Xarita</button></div>
      <p class="hint">Xarita rasmini yuklang, keyin jamoani tanlab xaritada tushish joyini bosing. Belgini bosish — olib tashlaydi. "Xarita (drop)" sahnasi joriy match xaritasini ko'rsatadi (hozir: <b>${esc(live.map)}</b>).</p></div>` +
      (m ? `<div class="mapw"><div class="box"><div class="row"><label style="flex:1">Nomi (match xaritasi nomi bilan bir xil bo'lsin)<input data-m="name" value="${esc(m.name)}"></label><span style="width:60px">${up('', 'mapimg', m.id, 'Xarita rasmi')}</span><button class="dng" data-a="mapDel">O'chirish</button></div>
        <div class="mapbox" id="mapbox">${m.img ? `<img src="${esc(m.img)}" draggable="false">` : '<div class="hint" style="padding:60px 20px;text-align:center">Xarita rasmi yuklanmagan (kvadrat rasm tavsiya etiladi)</div>'}
          ${teams.filter(t => m.drops[t.id]).map(t => `<button class="pin" data-a="mapUnpin" data-id="${t.id}" style="left:${m.drops[t.id][0] * 100}%;top:${m.drops[t.id][1] * 100}%">${t.logo ? `<img src="${esc(t.logo)}">` : ''}<span>${esc(t.tag)}</span></button>`).join('')}</div></div>
        <div class="box"><h3>Jamoalar (${teams.filter(t => m.drops[t.id]).length}/${teams.length} joylashtirilgan)</h3><div class="chips">${teams.map(t => `<button class="${ui.mapTeam === t.id ? 'on' : ''} ${m.drops[t.id] ? 'done' : ''}" data-a="mapArm" data-id="${t.id}">${esc(t.tag)}${m.drops[t.id] ? ' ✓' : ''}</button>`).join('')}</div></div></div>` : '');
  }

  /* ---------- RESULTS tab ---------- */
  function tbl(rows, live_) {
    return `<div class="tw"><table><tr><th>#</th><th class="l">Jamoa</th><th>O'rin</th><th>O'rin ochko</th><th>Kill</th><th>Jami</th></tr>${rows.map((r, i) =>
      `<tr><td>${i + 1}</td><td class="l">${esc(r.t.tag)} — ${esc(r.t.name)}</td><td>${live_ ? `<input type="number" min="1" data-place="${r.t.id}" value="${r.place || ''}">` : (r.place || '-')}</td><td>${r.pp}</td><td>${r.elims}</td><td><b>${r.total}</b></td></tr>`).join('')}</table></div>`;
  }
  function resultsHtml() {
    const sh = SH(), tot = U.playerTotals(cfg, sh, null), ov = U.overall(cfg, sh), mp = U.matchPoint(cfg, sh);
    const players = Object.keys(ix.p).filter(id => U.inStage(cfg, ix.p[id].t)).map(id => ({ id, e: ix.p[id], s: tot[id] || { k: 0, kn: 0, dmg: 0, surv: 0, n: 0 } })).sort((a, b) => b.s.k - a.s.k || b.s.dmg - a.s.dmg);
    const mark = r => mp.champ === r.t.id ? ' 🏆' : mp.mp[r.t.id] ? ' <span class="mp">MP</span>' : '';
    return `<div class="cols"><div class="box"><h3>Joriy match №${live.matchNo} (o'rinni qo'lda tuzatish mumkin)</h3>${tbl(U.matchRows(cfg, live), true)}</div>
      <div class="box"><h3>Joriy match — o'yinchi damage (ixtiyoriy)</h3><div class="tw"><table><tr><th class="l">O'yinchi</th><th>Kill</th><th>Nok</th><th>Damage</th></tr>
      ${U.teams(cfg).map(t => t.players.map(p => { const s = U.P(live, p.id); return `<tr><td class="l">${esc(t.tag)} · ${esc(p.name)}</td><td>${s.k || 0}</td><td>${s.kn || 0}</td><td><input type="number" data-dmg="${p.id}" value="${s.dmg || ''}"></td></tr>`; }).join('')).join('')}</table></div></div></div>
    <div class="cols"><div class="box"><h3>Umumiy reyting — ${esc(cfg.stage)} (${sh.matches.length} match)</h3>
      ${mp.on ? `<p class="hint">Match point: <b>${mp.target}</b> ochko. ${mp.champ ? `🏆 Chempion: <b>${esc((ix.t[mp.champ] || {}).name || '')}</b>` : `Match point'dagi jamoalar: <b>${Object.keys(mp.mp).map(id => esc((ix.t[id] || {}).tag)).join(', ') || 'hali yo\'q'}</b>`}</p>` : ''}
      <div class="tw"><table><tr><th>#</th><th class="l">Jamoa</th><th>WWCD</th><th>O'rin ochko</th><th>Kill</th><th>Jami</th></tr>${ov.map((r, i) => `<tr><td>${i + 1}</td><td class="l">${esc(r.t.tag)} — ${esc(r.t.name)}${mark(r)}</td><td>${r.wwcd}</td><td>${r.pp}</td><td>${r.elims}</td><td><b>${r.total}</b></td></tr>`).join('')}</table></div>
      <div class="row" style="margin-top:10px"><button class="pri" data-a="pngOverall">🖼 PNG: umumiy reyting</button><button data-a="pngMatch">🖼 PNG: oxirgi match</button><button data-a="csvTeams">CSV: jamoalar</button><button data-a="csvPlayers">CSV: o'yinchilar</button></div></div>
      <div class="box"><h3>O'yinchilar (yakunlangan matchlar)</h3><div class="tw"><table><tr><th>#</th><th class="l">O'yinchi</th><th>Kill</th><th>Nok</th><th>Damage</th><th>O'rt. yashash</th></tr>
      ${players.slice(0, 30).map((x, i) => `<tr><td>${i + 1}</td><td class="l">${esc(x.e.t.tag)} · ${esc(x.e.p.name)}</td><td>${x.s.k}</td><td>${x.s.kn}</td><td>${Math.round(x.s.dmg)}</td><td>${x.s.n ? U.mmss(x.s.surv / x.s.n) : '-'}</td></tr>`).join('')}</table></div></div></div>
    <div class="box"><h3>Yakunlangan matchlar — ${esc(cfg.stage)}</h3>${hist.matches.map(m => (m.sid || 'main') !== cfg.stageId ? '' : `<details class="fm"><summary>Match ${m.no} — ${esc(m.map || '')} <small>· ${m.at ? new Date(m.at).toLocaleTimeString().slice(0, 5) : ''}</small></summary>${tbl(U.matchRows(cfg, m))}<div class="row" style="justify-content:flex-end;margin-top:6px"><button class="dng" data-a="delMatch" data-id="${esc(U.mid(m))}">🗑 Match ${m.no} natijasini o'chirish</button></div></details>`).join('') || '<p class="hint">Hali yo\'q.</p>'}</div>
    ${hist.trash.length ? `<div class="box"><h3>O'chirilgan natijalar <small>(qaytarish mumkin)</small></h3>${hist.trash.map(m => `<div class="row"><span style="flex:1">Match ${m.no} — ${esc(m.map || '')} <small class="hint">· ${esc((cfg.stages.find(x => x.id === (m.sid || 'main')) || {}).name || '?')} · o'chirildi ${m.deletedAt ? new Date(m.deletedAt).toLocaleString().slice(0, 17) : ''}</small></span><button data-a="undelMatch" data-id="${esc(U.mid(m))}">↩ Qaytarish</button></div>`).join('')}</div>` : ''}`;
  }

  /* ---------- SETTINGS tab ---------- */
  function settingsHtml() {
    const base = location.href.replace(/admin\.html.*$/, ''), rq = Store.room !== 'main' ? '?room=' + encodeURIComponent(Store.room) : '';
    const url = `${base}overlay.html${rq}`, pub = `${base}table.html${rq}`;
    return `<div class="cols"><div class="box"><h3>Brend</h3>
      <div class="row"><span style="width:64px">${up(cfg.logo, 'logo', '', 'Turnir logosi')}</span><div style="flex:1"><label>Turnir nomi<input data-g="title" value="${esc(cfg.title)}"></label></div></div>
      <div class="row"><label>Asosiy rang<input type="color" data-g="accent" value="${esc(cfg.accent === '#ff6a1a' ? '#d0142c' : cfg.accent)}"></label>
        <label>O'z fon rasmingiz (ixtiyoriy, 1920×1080)<span class="row" style="margin:0"><span style="width:96px">${up(cfg.bg, 'bg', '', 'Fon rasmi')}</span>${cfg.bg ? '<button class="dng" data-a="delBg">O\'chirish</button>' : ''}</span></label></div>
      <h3 style="margin-top:12px">Logo va nom sahnalarda</h3>
      <div class="row"><label style="flex:1">Joylashuvi<select data-g="bpos">${[['tr', 'O\'ng yuqori burchak'], ['tl', 'Chap yuqori burchak'], ['top', 'Tepada markazda (sarlavha ustida)'], ['bottom', 'Pastda, homiylar qatorida'], ['none', 'Ko\'rsatilmasin']].map(o => `<option value="${o[0]}" ${cfg.brand.pos === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></label>
        <label>O'lchami<select data-g="bsize">${[['s', 'Kichik'], ['m', 'O\'rta'], ['l', 'Katta']].map(o => `<option value="${o[0]}" ${cfg.brand.size === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></label></div>
      <div class="row"><label><span><input type="checkbox" data-g="bname" ${cfg.brand.name ? 'checked' : ''}> Logo yonida turnir nomini ham yozish</span></label></div>
      <h3 style="margin-top:12px">Standart personajlar</h3>
      <p class="hint">Rasmi yuklanmagan o'yinchilar o'rnida chiqadi: jamoadagi 1-o'yinchiga 1-personaj, 2-o'yinchiga 2-personaj va h.k. Foni shaffof PNG yuklang (beldan yuqori, tik kadr).</p>
      <div class="chars">${U.DEF_CHARS.map((d, i) => `<div class="chr"><span class="up" title="${i + 1}-personajni almashtirish"><img src="${esc(cfg.chars[i] || d)}"><input type="file" accept="image/*" data-c="char" data-id="${i}"></span><b>${i + 1}</b>${cfg.chars[i] ? `<button class="dng" data-a="charReset" data-id="${i}" title="Asl personajga qaytarish">↺</button>` : ''}</div>`).join('')}</div>
      <h3 style="margin-top:12px">Homiylar</h3>
      <div class="spn">${cfg.sponsors.map((s, i) => `<span class="up"><img src="${esc(s)}"><button class="dng" data-a="delSp" data-id="${i}" style="position:absolute;right:2px;top:2px;padding:0 6px">✕</button></span>`).join('')}${up('', 'sponsor', '', 'Homiy logosi')}</div></div>
    <div class="box"><h3>Bosqichlar (kun / guruh / final)</h3><p class="hint">Har bir bosqichning o'z matchlari va o'z jadvali bor. Joriy bosqich ekranda ko'rsatiladi.</p>
      ${cfg.stages.map(s => `<div class="stg ${s.id === cfg.stageId ? 'cur' : ''}"><div class="row"><input data-sn="${s.id}" value="${esc(s.name)}"><button class="${s.id === cfg.stageId ? 'on' : ''}" data-a="stageUse" data-id="${s.id}">${s.id === cfg.stageId ? '● Joriy' : 'Tanlash'}</button>${cfg.stages.length > 1 ? `<button class="dng" data-a="stageDel" data-id="${s.id}">✕</button>` : ''}</div>
        <details><summary>Jamoalar: ${s.teams ? s.teams.filter(id => ix.t[id]).length + ' ta tanlangan' : 'hammasi'} · ${hist.matches.filter(m => (m.sid || 'main') === s.id).length} match</summary>
        <div class="chips">${cfg.teams.map(t => `<label class="ck"><input type="checkbox" data-st="${t.id}" data-id="${s.id}" ${!s.teams || s.teams.includes(t.id) ? 'checked' : ''}> ${esc(t.tag)}</label>`).join('')}</div>
        <button data-a="stageAll" data-id="${s.id}">Hammasini belgilash</button></details></div>`).join('')}
      <button class="pri" data-a="stageAdd">+ Bosqich qo'shish</button></div></div>
    <div class="cols"><div class="box"><h3>Ochkolar</h3><label>O'rin ochkolari (1-o'rindan boshlab, vergul bilan)<input data-g="place" value="${cfg.points.place.join(', ')}"></label>
      <label style="margin-top:6px">Har bir kill uchun<input type="number" data-g="kill" value="${cfg.points.kill}"></label>
      <h3 style="margin-top:12px">Match point qoidasi</h3>
      <div class="row"><label><span><input type="checkbox" data-g="mpOn" ${cfg.matchPoint.on ? 'checked' : ''}> Yoqish</span></label><label>Kerakli ochko<input type="number" data-g="mpTarget" value="${cfg.matchPoint.target}" style="width:90px"></label></div>
      <p class="hint">Yoqilsa: shu ochkoga yetgan jamoa "match point"da bo'ladi va keyingi WWCD'ni olsa — chempion. Jadvalda belgilanadi.</p></div>
    <div class="box"><h3>Avtomatik bannerlar</h3>
      <div class="row"><label><span><input type="checkbox" data-g="teamElim" ${cfg.auto.teamElim ? 'checked' : ''}> Jamoa yopilganda "ELIMINATED"</span></label></div>
      <div class="row"><label><span><input type="checkbox" data-g="stealer" ${cfg.auto.stealer ? 'checked' : ''}> Boshqa jamoa nokini o'ldirsa "ELIM STEALER"</span></label></div>
      <div class="row"><label><span><input type="checkbox" data-g="firstBlood" ${cfg.auto.firstBlood ? 'checked' : ''}> Birinchi kill "FIRST BLOOD"</span></label></div>
      <div class="row"><label>Rampage (o'yinchi killi, 0 = o'chiq)<input type="number" data-g="rampage" value="${cfg.auto.rampage}"></label><label>Domination (jamoa killi)<input type="number" data-g="domination" value="${cfg.auto.domination}"></label><label>Zona banneri (sek)<input type="number" data-g="zoneShowAt" value="${cfg.zoneShowAt}"></label></div></div></div>
    <div class="cols"><div class="box"><h3>OBS ga ulash</h3><p>OBS → Sources → <b>Browser</b> → URL: <code>${esc(url)}</code> · Width <b>1920</b>, Height <b>1080</b>.</p>
      <p class="hint">OBS sahnasi (Settings → Video → Base Canvas) ham <b>1920×1080</b> bo'lsin. Boshqa o'lcham bo'lsa, overlay manbasini sichqonchada o'ng tugma → <b>Transform → Fit to screen</b> qiling. Manba 16:9 bo'lmasa, overlay markazga moslashadi.</p>
      <h3 style="margin-top:12px">Reyting joylashuvi</h3>
      <div class="row"><span>Yuqoridan</span><input type="range" min="100" max="520" step="10" data-g="rankTop" value="${cfg.layout.rankTop}" style="flex:1"><b class="rkv" style="width:56px;text-align:right">${cfg.layout.rankTop} px</b></div>
      <p class="hint">O'yinning o'z minixaritasi ostiga tushishi uchun kattaroq qiling (standart 270). Ko'p jamoa bo'lsa, qatorlar o'zi ixchamlashadi.</p>
      <div class="row"><button data-a="copy" data-v="${esc(url)}">URL nusxalash</button><a href="${esc(url)}${rq ? '&' : '?'}preview" target="_blank"><button>Ko'rib chiqish (fon bilan)</button></a></div>
      <p class="hint">Ovoz effektlari uchun OBS'da manba sozlamasida <b>"Control audio via OBS"</b> ni belgilang. Rejim: <b>${Store.mode === 'supabase' ? 'Internet (Supabase)' : 'Lokal — faqat shu brauzerda'}</b> · Xona: <b>${esc(Store.room)}</b></p></div>
    <div class="box"><h3>Tomoshabinlar uchun jonli jadval</h3><p>Havola: <code>${esc(pub)}</code></p>
      <div class="row"><button data-a="copy" data-v="${esc(pub)}">Havolani nusxalash</button><a href="${esc(pub)}" target="_blank"><button>Ochish</button></a></div>
      <p class="hint">Telefonda ochiladi: umumiy reyting, jonli match va natijalar. Har 10 soniyada o'zi yangilanadi.</p></div></div>
    <div class="cols"><div class="box"><h3>📱 Telefon / planshetdan kill kiritish</h3><p>Havola: <code>${esc(base + 'admin.html?' + (rq ? rq.slice(1) + '&' : '') + 'm=1')}</code></p>
      <div class="row"><button data-a="copy" data-v="${esc(base + 'admin.html?' + (rq ? rq.slice(1) + '&' : '') + 'm=1')}">Havolani nusxalash</button></div>
      <p class="hint">Faqat kill / nok / turg'izish uchun katta tugmali sahifa. Ikkinchi admin telefondan shu havola bilan kirib kill yozadi, siz kompyuterda banner va sahnalarni boshqarasiz. Oddiy havola avvalgidek to'liq panelni ochadi.</p></div></div>
    <div class="cols">${Store.mode === 'supabase' ? `<div class="box"><h3>Bu turnir adminlari</h3><p class="hint">Ular faqat shu turnirni ko'radi va boshqaradi, bir vaqtda birga ishlashi mumkin. ${ME && ME.owner ? 'Yangi admin emailini qo\'shing — u admin sahifasida o\'sha email bilan ro\'yxatdan o\'tadi.' : 'Admin qo\'shish va o\'chirishni turnir egasi qiladi.'}</p>
      ${ui.admins === null ? '<p class="hint">Yuklanmoqda…</p>' : ui.admins.map(e => `<div class="row"><code style="flex:1">${esc(e)}</code>${ME && ME.owner ? `<button class="dng" data-a="delAdmin" data-v="${esc(e)}">✕</button>` : ''}</div>`).join('') || '<p class="hint">Hali admin qo\'shilmagan — hozircha faqat egasi boshqaradi.</p>'}
      ${ME && ME.owner ? `<div class="row"><input type="email" data-u="newAdmin" placeholder="admin@email.com" value="${esc(ui.newAdmin)}"><button class="pri" data-a="addAdmin">Qo'shish</button></div>` : ''}</div>` : ''}
    <div class="box"><h3>Zaxira nusxa</h3><p class="hint">Barcha jamoalar, rasmlar, xaritalar va natijalar bitta faylda. Turnirdan oldin va keyin saqlab qo'ying.</p>
      <div class="row"><button class="pri" data-a="backup">⬇ Zaxira faylini yuklab olish</button><label class="filebtn">⬆ Fayldan tiklash<input type="file" accept=".json,application/json" data-c="restore"></label></div>
      <h3 style="margin-top:12px">Xavfli zona</h3><div class="row"><button class="dng" data-a="resetMatch">Joriy matchni tozalash</button><button class="dng" data-a="resetHist">Shu bosqich natijalarini o'chirish</button>${Store.mode === 'supabase' ? '<button data-a="logout">Chiqish</button>' : ''}</div></div></div>`;
  }

  let sideT = 0;
  function renderSide() {
    const a = document.activeElement;
    if (a && a.closest && a.closest('#side') && /INPUT|SELECT/.test(a.tagName)) return;   // don't wipe a field being typed in
    const open = $('#side details') && $('#side details').open;
    $('#side').innerHTML = sideHtml(); if (open) $('#side details').open = true;
  }
  let ready = false;                                 // nothing is drawn before the tournament's data has really been read
  function render() {
    if (!ready) return;
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === tab));
    $('#undo').disabled = !undo.length;
    const m = $('#main');
    if (tab === 'live') {
      if (!$('#grid')) m.innerHTML = MOB
        ? `<div class="live"><div><div id="bar"><div id="atk"></div><div id="rec"></div><input id="filter" placeholder="Qidirish: jamoa yoki o'yinchi…" value="${esc(filter)}"></div><div id="grid"></div><div class="box"><h3>Oxirgi harakatlar <small>(bosib tuzating)</small></h3><div class="log" id="mlog"></div></div><p class="hint" style="text-align:center"><a href="${esc(location.pathname + '?' + (() => { const q = new URLSearchParams(location.search); q.set('m', '0'); return q; })())}">💻 To'liq panelni ochish</a></p></div></div>`
        : `<div class="live"><div><div id="bar"><div id="atk"></div><input id="filter" placeholder="Qidirish: jamoa yoki o'yinchi…" value="${esc(filter)}"></div><div id="rec"></div><div id="grid"></div></div><aside id="side"></aside></div>`;
      $('#grid').innerHTML = gridHtml();
      $('#atk').innerHTML = atkHtml(); $('#atk').classList.toggle('has', !!(sel && ix.p[sel]));
      $('#rec').innerHTML = recHtml();
      if (MOB) { const a = document.activeElement; if (!(a && a.closest && a.closest('#mlog'))) $('#mlog').innerHTML = logHtml(); return; }
      // focus is "nowhere" while it moves from one field to another (the old one's change event): wait until it has landed
      const a = document.activeElement;
      if (!a || a === document.body) { clearTimeout(sideT); sideT = setTimeout(() => tab === 'live' && $('#side') && renderSide(), 0); }
      else renderSide();
    } else {
      const y = scrollY, a = document.activeElement;
      if (a && /INPUT|TEXTAREA/.test(a.tagName) && a.type !== 'checkbox' && a.type !== 'file' && m.contains(a)) return;   // don't wipe a field being typed in
      const opened = [...m.querySelectorAll('details')].map(d => d.open);
      m.innerHTML = tab === 'teams' ? teamsHtml() : tab === 'map' ? mapHtml() : tab === 'results' ? resultsHtml() : settingsHtml();
      m.querySelectorAll('details').forEach((d, i) => { if (opened[i]) d.open = true; });
      scrollTo(0, y);
    }
  }

  /* ---------- match end, exports, backup ---------- */
  async function finish() {
    if (!U.liveRanking(cfg, live).length) return;
    if (!confirm(`Match ${live.matchNo} yakunlansinmi? Natija saqlanadi va yangi match ochiladi.`)) return;
    await pumpDone;                                              // everything typed so far is saved first
    const fresh = await Store.loadStrict('live');               // another admin may have finished / changed it meanwhile
    if (fresh.ok && fresh.data && (fresh.data._s || 0) > (server._s || 0) && !pumping) { server = U.normLive(fresh.data); live = U.normLive(U.clone(server)); render(); }
    const rows = U.liveRanking(cfg, live), dur = elapsed(), timed = !!live.startedAt;
    // teams still without a placement get the best free places, by players alive then elims
    const used = new Set(rows.map(r => r.place).filter(Boolean));
    let next = 1;
    rows.filter(r => !r.place).sort((a, b) => b.alive - a.alive || b.elims - a.elims).forEach(r => {
      while (used.has(next)) next++;
      r.place = next; used.add(next);
    });
    const rec = { id: U.uid(), no: live.matchNo, map: live.map, sid: cfg.stageId, at: Date.now(), teams: {}, players: {} };
    rows.forEach(r => {
      rec.teams[r.t.id] = { place: r.place, elims: r.elims };
      r.pl.forEach(p => { rec.players[p.id] = { k: p.k || 0, kn: p.kn || 0, dmg: +p.dmg || 0, surv: !timed ? null : p.st === 'd' ? (p.dt || 0) : dur }; });
    });
    histAct(h => { if (!h.matches.some(m => m.id === rec.id)) h.matches.push(U.clone(rec)); });
    const no = rec.no + 1;
    undo = []; sel = null; cur = null; kb = '';
    const mus = live.show.scene === 'champion' ? sceneMusic(null) : null;     // the fanfare ends with the champion scene
    act(() => {
      const n = U.defLive(no);
      n.map = live.map; n.show = Object.assign({}, live.show, { scene: live.show.scene === 'champion' ? null : live.show.scene, wwcd: false });
      if (mus) n.show.music = U.clone(mus);
      live = n;
    }, true);
    tab = 'results'; $('#main').innerHTML = ''; render();
  }
  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  function csv(name, rows) {
    download(name, new Blob(['﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' }));
  }
  function newTeam(tag, name, flag, players) {
    return { id: U.uid(), tag: tag || 'TAG', name: name || '', flag: flag || '', logo: '', players: (players || ['Player 1', 'Player 2', 'Player 3', 'Player 4']).map(n => ({ id: U.uid(), name: n, photo: '' })) };
  }
  async function png(kind) {
    const sh = SH();
    if (!sh.matches.length) return alert('Hali yakunlangan match yo\'q');
    const last = sh.matches[sh.matches.length - 1], overall = kind === 'overall';
    const rows = overall ? U.overall(cfg, sh) : U.matchRows(cfg, last);
    const mp = U.matchPoint(cfg, sh), moves = {};
    if (overall && sh.matches.length > 1) { const before = U.overall(cfg, { matches: sh.matches.slice(0, -1) }); rows.forEach((r, i) => { moves[r.t.id] = before.findIndex(x => x.t.id === r.t.id) - i; }); }
    const pages = U.pages(rows.length);
    for (let pg = 0; pg < pages; pg++) {
    const part = rows.slice(pg * U.PER_PAGE, (pg + 1) * U.PER_PAGE), off = pg * U.PER_PAGE;
    const blob = await Exporter.ranking({
      title: overall ? 'OVERALL RANKING' : 'MATCH RESULTS',
      sub: (overall ? [cfg.stage, 'POST MATCH ' + sh.matches.length] : [cfg.stage, 'MATCH ' + last.no, last.map]).concat(pages > 1 ? [(pg + 1) + '/' + pages] : []),
      brand: { logo: cfg.logo, title: cfg.title, pos: cfg.brand.pos, size: cfg.brand.size, name: cfg.brand.name }, sponsors: cfg.sponsors, bg: cfg.bg,
      note: overall && mp.on && !pg ? 'MATCH POINT TARGET ' + mp.target : '',
      hero: { rank: off + 1, name: part[0].t.name || part[0].t.tag, tag: part[0].t.tag, flag: U.flagUrl(part[0].t.flag), logo: part[0].t.logo, photos: part[0].t.players.map(p => U.photo(part[0].t, p)) }, first: !pg,
      rows: part.map((r, i) => ({ rank: off + i + 1, mv: overall ? (moves[r.t.id] || 0) : null, flag: U.flagUrl(r.t.flag), logo: r.t.logo, tag: r.t.tag || r.t.name, mark: overall && mp.champ === r.t.id ? 'champ' : overall && mp.mp[r.t.id] ? 'mp' : '', cols: [overall ? r.wwcd : (r.wwcd ? '●' : '0'), r.pp, r.elims, r.total] }))
    });
    if (blob) download((overall ? 'overall' : 'match-' + last.no) + (pages > 1 ? '-' + (pg + 1) : '') + '.png', blob); else return alert('Rasm yaratilmadi');
    if (pg < pages - 1) await new Promise(r => setTimeout(r, 400));   // browsers drop downloads fired at the same instant
    }
  }

  /* a manual choice ends the scene music */
  function setMusic(next) { const v = U.clone(next); delete v.auto; delete v.prev; act(() => { live.show.music = U.clone(v); }); }
  /* scene music: what the music should become when the screen shows `show` (null = leave it alone) */
  function sceneMusic(show, force) {
    if (!force && live.show.autoMusic === false) return null;
    const m = MU(), k = U.musicKey(show), t = k && U.track(cfg, cfg.musicMap[k]);
    if (t) {
      if (m.auto && m.id === t.id && m.playing) return null;            // already playing it
      const prev = m.auto ? m.prev : { id: m.id, playing: !!m.playing };
      return Object.assign(m, { id: t.id, playing: true, cmd: U.uid(), auto: k === 'champion' ? 'once' : 'loop', prev });
    }
    return m.auto ? musicBack(m) : null;
  }
  /* back to what was playing before the scene music started */
  function musicBack(m) {
    const p = m.prev || {}, r = Object.assign({}, m, { id: p.playing ? p.id : null, playing: !!p.playing, cmd: U.uid() });
    delete r.auto; delete r.prev; return r;
  }
  function muStep(dir) {
    const all = U.tracks(cfg);
    const m = MU(), i = all.findIndex(t => t.id === m.id), n = all.length;
    const id = all[((i < 0 ? (dir > 0 ? -1 : 0) : i) + dir + n) % n].id;
    setMusic(Object.assign(m, { id, playing: true, cmd: U.uid() }));
  }
  async function uploadMusic(files) {
    ui.uploading = true; render();
    for (const f of files) {
      if (!/^audio\//.test(f.type) && !/\.(mp3|m4a|wav|ogg|aac|flac)$/i.test(f.name)) { alert(f.name + ': bu audio fayl emas'); continue; }
      if (f.size > 30 * 1024 * 1024) { alert(f.name + ': fayl juda katta (30 MB gacha)'); continue; }
      const r = await Store.uploadMedia(f);
      if (r.error) { alert(f.name + ': ' + r.error); continue; }
      cfg.music.push({ id: U.uid(), name: f.name.replace(/\.[^.]+$/, ''), url: r.url }); saveCfg();
    }
    ui.uploading = false; render();
  }

  const INFO = {
    soon: () => ({ h1: 'STARTING SOON', h2: cfg.stage }),
    next: () => ({ h1: 'NEXT MATCH', h2: 'MATCH ' + live.matchNo + ' ▪ ' + live.map }),
    break: () => ({ h1: 'BE RIGHT BACK', h2: cfg.stage })
  };

  const A = {
    tab(d) { tab = d.v; $('#main').innerHTML = ''; if (tab === 'settings' && Store.mode === 'supabase') Store.roomAdmins(Store.room).then(a => { ui.admins = a; if (tab === 'settings') render(); }); render(); },
    undo: undoLast,
    sel(d) { sel = sel === d.id ? null : d.id; render(); },
    unsel() { sel = null; render(); },
    kp(d) { const id = d.id; act(() => { P(id).k++; }); },
    km(d) { const id = d.id; act(() => { const p = P(id); p.k = Math.max(0, (p.k || 0) - 1); }); },
    knock(d) { knock(d.id); },
    kill(d) { kill(d.id); },
    wipe(d) { const t = ix.t[d.id]; if (t && confirm(`${t.tag} jamoasi to'liq yopilsinmi? (zona yoki o'yindan chiqib ketdi — kill hech kimga yozilmaydi)`)) wipe(d.id); },
    keepAtk() { keepAtk = !keepAtk; try { localStorage.setItem('pgo:pref:keepAtk', keepAtk ? '1' : '0'); } catch (e) { /* private mode */ } render(); },
    logEd(d) { ui.logEd = ui.logEd === d.id ? '' : d.id; render(); },
    logDel(d) { const id = d.id; ui.logEd = ''; logDel(id); },
    show(d) { const k = d.v; act(() => { live.show[k] = !live.show[k]; }); },
    scene(d) {
      const v = d.v || null, o = { scene: v };
      const winner = cfg.teams.find(t => (live.teams[t.id] || {}).place === 1);
      const tid = ui.team || (winner && winner.id) || (sel && teamOf(sel) && teamOf(sel).id) || null;
      if (v === 'team' || v === 'champion') { if (!tid) return alert('Avval jamoani tanlang'); o.sceneTeam = tid; }
      if (v === 'vs') { if (!ui.team || !ui.team2 || ui.team === ui.team2) return alert('Ikki xil jamoani tanlang (A va B)'); o.sceneTeam = ui.team; o.sceneTeam2 = ui.team2; }
      if (v === 'mvp1') { if (d.s === 'pick' && !(sel && ix.p[sel])) return; o.mvp = { scope: d.s, pid: d.s === 'pick' ? sel : null }; }
      if (v === 'info') {
        const p = INFO[d.k](), min = +ui.imin || 0;
        o.info = { kind: d.k, h1: ui.ih1.trim() || p.h1, h2: p.h2, cd: min > 0 ? { id: U.uid(), sec: Math.round(min * 60), at: Date.now() } : null };
      }
      if (v === 'results' || v === 'overall') o.page = 0;
      const key = sceneKey(Object.assign({}, live.show, o));
      const closing = !v || sceneKey(live.show) === key;
      const mus = sceneMusic(closing ? null : Object.assign({}, live.show, o));    // computed once: act() may run twice
      act(() => { if (closing) live.show.scene = null; else Object.assign(live.show, o); if (mus) live.show.music = U.clone(mus); });
    },
    zone() { const sec = Math.max(1, +ui.zone || 30); act(() => { live.zone = { id: U.uid(), sec, at: Date.now() }; }); },
    page(d) { const p = +d.v; act(() => { live.show.page = p; }); },
    /* the new state is computed once here: act() may apply the change twice (screen + save) */
    muToggle() { const m = MU(), id = m.id || (U.tracks(cfg)[0] || {}).id; if (!id) return; setMusic(Object.assign(m, { id, playing: !m.playing, cmd: m.id ? m.cmd : U.uid() })); },
    muPlay(d) { const m = MU(); setMusic(m.id === d.id ? Object.assign(m, { playing: !m.playing }) : Object.assign(m, { id: d.id, playing: true, cmd: U.uid() })); },
    muStop() { setMusic(Object.assign(MU(), { playing: false, id: null, cmd: U.uid() })); },
    muNext() { muStep(1); }, muPrev() { muStep(-1); },
    muMode(d) { setMusic(Object.assign(MU(), { mode: d.v })); },
    autoMu() {
      const on = live.show.autoMusic === false, m = MU();
      const mus = on ? sceneMusic(live.show, true) : (m.auto ? musicBack(m) : null);
      act(() => { live.show.autoMusic = on; if (mus) live.show.music = U.clone(mus); });
    },
    mmOpen() { ui.mmOpen = !ui.mmOpen; render(); },
    cam(d) { const k = d.k, v = k === 'on' ? !!d.v : d.v; act(() => { live.show.cam = Object.assign({}, live.show.cam, { [k]: v }); }); },
    async muDel(d) {
      const t = cfg.music.find(x => x.id === d.id); if (!t || !confirm(`"${t.name}" o'chirilsinmi?`)) return;
      if (MU().id === t.id) A.muStop();
      Object.keys(cfg.musicMap).forEach(k => { if (cfg.musicMap[k] === t.id) cfg.musicMap[k] = ''; });
      cfg.music = cfg.music.filter(x => x !== t); saveCfg(); render(); Store.deleteMedia(t.url);
    },
    zoneOff() { act(() => { live.zone = null; }); },
    bn(d) {
      if (!sel || !ix.p[sel]) return;
      const t = teamOf(sel), k = P(sel).k || 0;
      const b = { type: d.v, pid: sel };
      if (d.v === 'sharp') b.v = ui.dist;
      if (d.v === 'damage') b.v = ui.dmg;
      if (d.v === 'rampage') b.v = k;
      if (d.v === 'domination') { delete b.pid; b.tid = t.id; b.v = U.teamLive(cfg, live, t).elims; }
      if (d.v === 'custom') { if (!ui.c1 && !ui.c2) return; b.l1 = ui.c1; b.l2 = ui.c2; }
      act(() => banner(b));
    },
    timer() { if (live.startedAt && !confirm('Taymer qayta boshlansinmi?')) return; act(() => { live.startedAt = Date.now(); }); },
    finish,
    addTeam() { cfg.teams.push(newTeam('', '', '', null)); saveCfg(); render(); },
    delTeam(d) { if (!confirm('Jamoa o\'chirilsinmi?')) return; cfg.teams = cfg.teams.filter(t => t.id !== d.id); saveCfg(); render(); },
    addPl(d) { ix.t[d.id].players.push({ id: U.uid(), name: 'Player', photo: '' }); saveCfg(); render(); },
    delPl(d) { const t = teamOf(d.id); t.players = t.players.filter(p => p.id !== d.id); saveCfg(); render(); },
    demo() {
      if (cfg.teams.length && !confirm('Mavjud jamoalar ustiga 16 ta namuna jamoa qo\'shilsinmi?')) return;
      const codes = ['uz', 'tr', 'id', 'br', 'us', 'mn', 'np', 'th', 'kz', 'sa', 'iq', 'my', 'pk', 'kr', 'jp', 'de'];
      for (let i = 1; i <= 16; i++) cfg.teams.push(newTeam('T' + String(i).padStart(2, '0'), 'Team ' + i, codes[i - 1], [1, 2, 3, 4].map(n => `T${i}_Player${n}`)));
      saveCfg(); render();
    },
    bulk() {
      $('#bulk').value.split('\n').map(l => l.split(',').map(s => s.trim())).filter(a => a[0]).forEach(a => {
        const pl = a.slice(3).filter(Boolean);
        cfg.teams.push(newTeam(a[0].toUpperCase(), a[1] || a[0], a[2] || '', pl.length ? pl : null));
      });
      saveCfg(); render();
    },
    charReset(d) { cfg.chars[+d.id] = ''; saveCfg(); render(); },
    delBg() { cfg.bg = ''; saveCfg(); render(); },
    delSp(d) { cfg.sponsors.splice(+d.id, 1); saveCfg(); render(); },
    delMatch(d) {
      const m = hist.matches.find(x => U.mid(x) === d.id); if (!m) return;
      if (!confirm(`Match ${m.no} NATIJASI butunlay o'chirilsinmi?\nU umumiy reytingdan ham chiqib ketadi. ("O'chirilgan natijalar" dan qaytarish mumkin)`)) return;
      const id = d.id; histAct(h => { const i = h.matches.findIndex(x => U.mid(x) === id); if (i >= 0) toTrash(h, h.matches.splice(i, 1)); });
    },
    undelMatch(d) {
      const id = d.id; histAct(h => {
        const i = h.trash.findIndex(x => U.mid(x) === id); if (i < 0) return;
        const m = h.trash.splice(i, 1)[0]; delete m.deletedAt;
        if (!h.matches.some(x => U.mid(x) === id)) { h.matches.push(m); h.matches.sort((a, b) => (a.at || 0) - (b.at || 0)); }
      });
    },
    resetMatch() { if (!confirm('Joriy match tozalansinmi?')) return; act(() => { const n = U.defLive(live.matchNo); n.map = live.map; n.show = live.show; live = n; }); },
    resetHist() {
      if (!confirm(`"${cfg.stage}" bosqichining BARCHA yakunlangan matchlari o'chirilsinmi?`)) return;
      const sid = cfg.stageId; histAct(h => { toTrash(h, h.matches.filter(m => (m.sid || 'main') === sid)); h.matches = h.matches.filter(m => (m.sid || 'main') !== sid); }); act(() => { live.matchNo = 1; });
    },
    /* stages */
    stageAdd() { const name = prompt('Bosqich nomi (masalan: DAY 2, GROUP B, SEMI FINALS)'); if (!name) return; cfg.stages.push({ id: U.uid(), name: name.toUpperCase(), teams: null }); saveCfg(); render(); },
    stageUse(d) {
      if (d.id === cfg.stageId) return;
      if (Object.keys(live.players).length && !confirm('Joriy matchda ma\'lumot bor. Bosqich almashtirilsinmi? (match yangi bosqichga o\'tadi)')) return;
      cfg.stageId = d.id; saveCfg();
      const no = SH().matches.length + 1; act(() => { live.matchNo = no; }, true);
    },
    stageDel(d) {
      const n = hist.matches.filter(m => (m.sid || 'main') === d.id).length;
      if (!confirm(`Bosqich${n ? ' va uning ' + n + ' ta match natijasi' : ''} o'chirilsinmi?`)) return;
      cfg.stages = cfg.stages.filter(s => s.id !== d.id);
      if (n) { const sid = d.id; histAct(h => { toTrash(h, h.matches.filter(m => (m.sid || 'main') === sid)); h.matches = h.matches.filter(m => (m.sid || 'main') !== sid); }); }
      saveCfg(); render();
    },
    stageAll(d) { cfg.stages.find(s => s.id === d.id).teams = null; saveCfg(); render(); },
    /* maps */
    mapAdd() { const name = prompt('Xarita nomi (masalan: ERANGEL)', live.map); if (!name) return; const m = { id: U.uid(), name: name.toUpperCase(), img: '', drops: {} }; maps.list.push(m); ui.mapId = m.id; saveMaps(); render(); },
    mapPick(d) { ui.mapId = d.id; ui.mapTeam = ''; render(); },
    mapDel() { const m = curMap(); if (!m || !confirm('Xarita o\'chirilsinmi?')) return; maps.list = maps.list.filter(x => x !== m); ui.mapId = ''; saveMaps(); render(); },
    mapArm(d) { ui.mapTeam = ui.mapTeam === d.id ? '' : d.id; render(); },
    mapUnpin(d) { const m = curMap(); delete m.drops[d.id]; saveMaps(); render(); },
    /* admins, backup */
    async addAdmin() { const e = ui.newAdmin.trim(); if (!e) return; const err = await Store.addRoomAdmin(Store.room, e); if (err) return alert(err); ui.newAdmin = ''; ui.admins = await Store.roomAdmins(Store.room); render(); },
    async delAdmin(d) { if (!confirm(d.v + ' bu turnir adminlaridan olib tashlansinmi?')) return; const err = await Store.delRoomAdmin(Store.room, d.v); if (err) return alert(err); ui.admins = await Store.roomAdmins(Store.room); render(); },
    async backup() { await pumpDone; download(`overlay-backup-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify({ v: 1, room: Store.room, config: cfg, live, history: hist, maps })], { type: 'application/json' })); },
    copy(d) { navigator.clipboard && navigator.clipboard.writeText(d.v); },
    async logout() { await Store.signOut(); location.reload(); },
    pngOverall() { png('overall'); },
    pngMatch() { png('match'); },
    csvTeams() { csv('standings.csv', [['Rank', 'Tag', 'Team', 'WWCD', 'Place pts', 'Elims', 'Total']].concat(U.overall(cfg, SH()).map((r, i) => [i + 1, r.t.tag, r.t.name, r.wwcd, r.pp, r.elims, r.total]))); },
    csvPlayers() {
      const tot = U.playerTotals(cfg, SH(), null);
      csv('players.csv', [['Team', 'Player', 'Elims', 'Knocks', 'Damage', 'Matches', 'Avg survival']].concat(Object.keys(ix.p).map(id => { const s = tot[id] || { k: 0, kn: 0, dmg: 0, surv: 0, n: 0 }; return [ix.p[id].t.tag, ix.p[id].p.name, s.k, s.kn, Math.round(s.dmg), s.n, s.n ? U.mmss(s.surv / s.n) : '']; })));
    }
  };

  async function restore(file) {
    let d; try { d = JSON.parse(await file.text()); } catch (e) { return alert('Fayl o\'qilmadi'); }
    if (!d || !d.config || !d.history) return alert('Bu zaxira fayli emas');
    if (!confirm('Hozirgi BARCHA ma\'lumotlar shu fayldagi bilan almashtiriladi. Davom etilsinmi?')) return;
    cfg = U.normConfig(d.config); maps = U.normMaps(d.maps);
    const bm = U.normHist(U.clone(d.history)).matches;
    saveCfg(); saveMaps(); histAct(h => { toTrash(h, h.matches); h.matches = U.clone(bm); });
    const L = U.normLive(d.live); undo = [];
    act(() => { live = U.clone(L); }, true);
    alert('Tiklandi');
  }

  /* ---------- events ---------- */
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-a]');
    if (el && A[el.dataset.a]) { if (el.closest('summary')) e.preventDefault(); A[el.dataset.a](el.dataset); return; }
    const box = e.target.closest('#mapbox');
    if (box && ui.mapTeam && curMap() && curMap().img) {            // place the armed team on the map
      const r = box.getBoundingClientRect(), m = curMap();
      m.drops[ui.mapTeam] = [+((e.clientX - r.left) / r.width).toFixed(4), +((e.clientY - r.top) / r.height).toFixed(4)];
      const rest = gridTeams().filter(t => t.players.length && !m.drops[t.id]);
      ui.mapTeam = rest.length ? rest[0].id : '';
      saveMaps(); render();
    }
  });
  document.addEventListener('input', e => {
    const el = e.target, d = el.dataset;
    if (el.id === 'filter') { filter = el.value; $('#grid').innerHTML = gridHtml(); }
    else if (d.u) ui[d.u] = el.value;
    else if (d.mu === 'vol') { const b = el.parentNode.querySelector('b'); if (b) b.textContent = el.value + '%'; }
    else if (d.g === 'rankTop') { const b = el.parentNode.querySelector('.rkv'); if (b) b.textContent = el.value + ' px'; }
    else if (d.cam) { clearTimeout(camT); const k = d.cam, v = el.value; camT = setTimeout(() => saveCam(k, v), 450); }   // saved while typing: leaving the field then changes nothing
  });
  let camT = 0;
  function saveCam(k, raw) {
    clearTimeout(camT);
    const v = raw.toUpperCase().slice(0, 40); if ((live.show.cam || {})[k] === v) return;
    act(() => { live.show.cam = Object.assign({}, live.show.cam, { [k]: v }); });
  }
  document.addEventListener('change', async e => {
    const el = e.target, d = el.dataset;
    if (d.c === 'music') { const fs = [...el.files]; el.value = ''; if (fs.length) uploadMusic(fs); return; }
    if (d.c === 'restore') { if (el.files[0]) restore(el.files[0]); el.value = ''; return; }
    if (d.c) { // image uploads
      const f = el.files[0]; if (!f) return;
      const src = await readImage(f, d.c === 'char' ? 760 : d.c === 'bg' ? 1920 : d.c === 'mapimg' ? 1100 : d.c === 'sponsor' ? 360 : d.c === 'pphoto' ? 400 : 200, d.c === 'mapimg' || d.c === 'bg' ? .86 : .82);
      if (!src) return alert('Rasm o\'qilmadi');
      if (d.c === 'mapimg') { maps.list.find(m => m.id === d.id).img = src; saveMaps(); render(); return; }
      if (d.c === 'tlogo') ix.t[d.id].logo = src;
      else if (d.c === 'pphoto') ix.p[d.id].p.photo = src;
      else if (d.c === 'logo') cfg.logo = src;
      else if (d.c === 'sponsor') cfg.sponsors.push(src);
      else if (d.c === 'bg') cfg.bg = src;
      else if (d.c === 'char') { while (cfg.chars.length < 4) cfg.chars.push(''); cfg.chars[+d.id] = src; }
      saveCfg(); render();
    } else if (d.t) { ix.t[d.id][d.t] = d.t === 'name' ? el.value : d.t === 'tag' ? el.value.toUpperCase() : el.value.toLowerCase(); saveCfg(); }
    else if (d.p) { ix.p[d.id].p.name = el.value; saveCfg(); }
    else if (d.m) { curMap()[d.m] = el.value.toUpperCase(); saveMaps(); }
    else if (d.sn) { cfg.stages.find(s => s.id === d.sn).name = el.value.toUpperCase(); saveCfg(); }
    else if (d.st) {
      const s = cfg.stages.find(x => x.id === d.id);
      if (!s.teams) s.teams = cfg.teams.map(t => t.id);
      s.teams = s.teams.filter(id => id !== d.st); if (el.checked) s.teams.push(d.st);
      saveCfg();
    }
    else if (d.l) { const k = d.l, v = k === 'matchNo' ? Math.max(1, +el.value || 1) : el.value.toUpperCase(); act(() => { live[k] = v; }); }
    else if (d.place) { const id = d.place, v = +el.value; act(() => { const r = live.teams[id] || (live.teams[id] = {}); if (v > 0) { r.place = v; r.m = 1; } else { delete r.place; delete r.m; } }); }
    else if (d.mu === 'vol') { const v = +el.value; act(() => { live.show.music = Object.assign({}, live.show.music, { vol: v }); }); }
    else if (d.cam) saveCam(d.cam, el.value);
    else if (d.le) { const id = d.le, na = el.value || null; ui.logEd = ''; el.blur(); logFix(id, na); }
    else if (d.mm) { cfg.musicMap[d.mm] = el.value; saveCfg(); render(); }
    else if (d.dmg) { const id = d.dmg, v = +el.value || 0; act(() => { P(id).dmg = v; }); }
    else if (d.g) {
      const k = d.g;
      if (k === 'place') cfg.points.place = el.value.split(',').map(s => +s.trim() || 0);
      else if (k === 'kill') cfg.points.kill = +el.value || 0;
      else if (k === 'mpOn') cfg.matchPoint.on = el.checked;
      else if (k === 'bpos') cfg.brand.pos = el.value;
      else if (k === 'bsize') cfg.brand.size = el.value;
      else if (k === 'bname') cfg.brand.name = el.checked;
      else if (k === 'rankTop') cfg.layout.rankTop = Math.max(100, Math.min(520, +el.value || 270));
      else if (k === 'mpTarget') cfg.matchPoint.target = Math.max(1, +el.value || 1);
      else if (k === 'teamElim' || k === 'stealer' || k === 'firstBlood') cfg.auto[k] = el.checked;
      else if (k === 'rampage' || k === 'domination') cfg.auto[k] = +el.value || 0;
      else if (k === 'zoneShowAt') cfg.zoneShowAt = Math.max(1, +el.value || 10);
      else cfg[k] = k === 'accent' ? el.value : el.value.toUpperCase();
      saveCfg();
    }
  });

  /* Keyboard: two digits = team, one digit = player, then A / K / N (works on any keyboard layout) */
  function pickByNumber() {
    const t = gridTeams()[+kb.slice(0, 2) - 1], p = t && t.players[+kb[2] - 1];
    cur = p ? p.id : null; kb = '';
  }
  document.addEventListener('keydown', e => {
    const a = document.activeElement, typing = a && /INPUT|TEXTAREA|SELECT/.test(a.tagName);
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !typing) { e.preventDefault(); undoLast(); return; }
    if (e.key === 'Escape') { if (typing) a.blur(); sel = null; cur = null; kb = ''; render(); return; }
    if (typing || tab !== 'live' || e.ctrlKey || e.metaKey || e.altKey) return;
    const dg = /^(Digit|Numpad)(\d)$/.exec(e.code);
    if (dg) { kb += dg[2]; cur = null; if (kb.length === 3) pickByNumber(); e.preventDefault(); render(); return; }
    if (e.code === 'Backspace') { kb = ''; cur = null; e.preventDefault(); render(); return; }
    if (!cur) return;
    const c = cur;
    if (e.code === 'KeyA' || e.code === 'Enter' || e.code === 'NumpadEnter') { sel = c; cur = null; e.preventDefault(); render(); }
    else if (e.code === 'KeyK') { cur = null; e.preventDefault(); kill(c); }
    else if (e.code === 'KeyN') { cur = null; e.preventDefault(); knock(c); }
  });
  setInterval(() => {
    const r = U.liveRanking(cfg, live);
    const pl = r.reduce((n, x) => n + x.alive, 0), tm = r.filter(x => !x.out).length;
    $('#clock').innerHTML = `<small>Tirik</small> ${pl} <small>Jamoa</small> ${tm} <small>Vaqt</small> ${U.mmss(elapsed())}`;
  }, 500);

  /* ---------- boot ---------- */
  Store.onStatus((s, msg) => {
    const el = $('#status');
    el.className = 'st ' + s;
    el.textContent = s === 'ok' ? '● Ulangan' : s === 'local' ? '● Lokal rejim' : '● ' + (msg || 'Xato');
  });
  Store.on('config', d => { if (started && d._w !== me) { cfg = U.normConfig(d); ix = U.index(cfg); render(); } });
  Store.on('history', d => { if (started && d._w !== me && (d._s || 0) >= (hist._s || 0)) { hist = U.normHist(d); render(); } });
  Store.on('maps', d => { if (started && d._w !== me) { maps = U.normMaps(d); render(); } });
  Store.on('live', d => {
    if (!started) return;
    if ((d._s || 0) <= (server._s || 0)) return;                 // our own write coming back, or something older
    server = U.normLive(d);
    if (!pumping && !queue.length) { live = U.normLive(U.clone(server)); render(); }
  });

  async function start() {
    started = true;
    // every document must really be read: an empty screen after a network error would later be saved over real data
    let rs;
    for (let i = 0; ; i++) {
      rs = await Promise.all(['config', 'live', 'history', 'maps'].map(k => Store.loadStrict(k)));
      if (rs.every(r => r.ok)) break;
      $('#main').innerHTML = `<div class="box"><h3>Ma'lumotlar yuklanmadi</h3><p class="hint">Internet aloqasini tekshiring — qayta urinilmoqda (${i + 1})…</p></div>`;
      await wait(2500);
    }
    const [c, l, h, m] = rs.map(r => r.data);
    cfg = U.normConfig(c); ix = U.index(cfg); hist = U.normHist(h); maps = U.normMaps(m);
    server = U.normLive(l); live = U.normLive(U.clone(server));
    ready = true; $('#main').innerHTML = '';
    if (!cfg.teams.length) tab = 'teams';
    else Store.set('pub', U.publicConfig(cfg));               // keep the public standings page in sync
    Store.presence(me, 'admin', n => {
      const w = $('#who'); w.hidden = n.admin < 2; w.textContent = '👥 ' + n.admin + ' admin';
      const o = $('#obs'); o.hidden = false; o.className = 'st ' + (n.overlay ? 'ok' : 'err');
      o.textContent = n.overlay ? '🟢 OBS ulangan' + (n.overlay > 1 ? ' ×' + n.overlay : '') : '🔴 OBS ulanmagan';
      o.title = n.overlay ? `Overlay hozir ${n.overlay} joyda ochiq (OBS yoki brauzer)` : 'OBS\'dagi overlay sahifasi ochiq emas yoki internetdan uzilgan';
    });
    render();
  }
  /* ---------- tournaments page (owner: all tournaments + their admins; admin: own tournaments) ---------- */
  const base = location.href.replace(/admin\.html.*$/, '');
  async function picker(msg) {
    document.body.classList.add('picking');
    $('#status').className = 'st ok'; $('#status').textContent = '● Ulangan';
    let list = [];
    try { list = ROOMS = await Store.rooms(); } catch (e) { msg = 'Turnirlar yuklanmadi: ' + e.message; }
    const members = ME.owner ? await Promise.all(list.map(r => Store.roomAdmins(r.room))) : [];
    $('#main').innerHTML = `<div class="pick"><div class="phd"><h2>Turnirlar</h2><span class="hint">${esc(ME.email)} · ${ME.owner ? '<b>asosiy admin</b>' : 'turnir admini'}</span><button data-a="logout">Chiqish</button></div>
      ${msg ? `<div class="box warn">${esc(msg)}</div>` : ''}
      ${ME.owner ? `<div class="box"><h3>Yangi turnir</h3><div class="row"><input data-u="newRoom" placeholder="Turnir nomi, masalan: ASADBEK SCRIMS" value="${esc(ui.newRoom)}"><button class="pri" data-a="roomNew">+ Ochish</button></div>
        <p class="hint">Har bir turnirning jamoalari, natijalari, OBS havolasi va jadval sahifasi alohida — boshqa turnirlar bilan aralashmaydi.</p></div>` : ''}
      ${!list.length ? `<div class="box"><p>${ME.owner ? 'Hali turnir yo\'q — yuqorida yangisini oching.' : 'Sizga hali turnir biriktirilmagan. Asosiy admin sizning emailingizni (<b>' + esc(ME.email) + '</b>) turnirga qo\'shishi kerak, keyin sahifani yangilang.'}</p></div>` : ''}
      <div class="rooms">${list.map((r, i) => `<div class="box room"><div class="rhd"><b>${esc(r.name)}</b><code>${esc(r.room)}</code></div>
        <div class="row"><a class="btn pri" href="admin.html?room=${encodeURIComponent(r.room)}${QS.has('m') ? '&m=' + encodeURIComponent(QS.get('m')) : ''}">Boshqarish →</a>
          <button data-a="copy" data-v="${esc(base + 'overlay.html?room=' + encodeURIComponent(r.room))}">OBS havolasi</button>
          <button data-a="copy" data-v="${esc(base + 'table.html?room=' + encodeURIComponent(r.room))}">Jadval havolasi</button></div>
        ${ME.owner ? `<h3>Adminlar</h3>${members[i].map(e => `<div class="row"><code style="flex:1">${esc(e)}</code><button class="dng" data-a="roomDelAdmin" data-r="${esc(r.room)}" data-v="${esc(e)}">✕</button></div>`).join('') || '<p class="hint">Admin yo\'q — faqat siz boshqarasiz.</p>'}
          <div class="row"><input type="email" data-ra="${esc(r.room)}" placeholder="admin@email.com" value="${esc(ui.add[r.room] || '')}"><button data-a="roomAddAdmin" data-r="${esc(r.room)}">+ Admin</button></div>
          <div class="row"><button data-a="roomRename" data-r="${esc(r.room)}" data-v="${esc(r.name)}">Nomini o'zgartirish</button><button class="dng" data-a="roomDel" data-r="${esc(r.room)}" data-v="${esc(r.name)}">Turnirni o'chirish</button></div>` : ''}</div>`).join('')}</div></div>`;
  }
  Object.assign(A, {
    async roomNew() { const n = ui.newRoom.trim(); if (!n) return; const r = await Store.createRoom(n); if (r.error) return alert(r.error); ui.newRoom = ''; picker(); },
    async roomRename(d) { const n = prompt('Yangi nom', d.v); if (!n) return; const err = await Store.renameRoom(d.r, n); if (err) return alert(err); picker(); },
    async roomDel(d) {
      if (prompt(`"${d.v}" turniri va uning BARCHA ma'lumotlari (jamoalar, natijalar, xaritalar) o'chiriladi.\nTasdiqlash uchun turnir nomini yozing:`) !== d.v) return;
      const err = await Store.deleteRoom(d.r); if (err) return alert(err); picker();
    },
    async roomAddAdmin(d) { const e = (ui.add[d.r] || '').trim(); if (!e) return; const err = await Store.addRoomAdmin(d.r, e); if (err) return alert(err); ui.add[d.r] = ''; picker(); },
    async roomDelAdmin(d) { if (!confirm(d.v + ' bu turnirdan olib tashlansinmi?')) return; const err = await Store.delRoomAdmin(d.r, d.v); if (err) return alert(err); picker(); }
  });
  document.addEventListener('input', e => { if (e.target.dataset.ra) ui.add[e.target.dataset.ra] = e.target.value; });

  /* after signing in: pick a tournament, or open the one in the address */
  async function enter() {
    ME = await Store.me();
    if (!ME) return location.reload();
    if (Store.mode !== 'supabase') return start();
    let list = [];
    try { list = ROOMS = await Store.rooms(); } catch (e) { return picker('Turnirlar yuklanmadi: ' + e.message); }
    if (!Store.roomParam) return picker();
    const r = list.find(x => x.room === Store.roomParam);
    if (!r) return picker('Bu turnirga ruxsatingiz yo\'q yoki u o\'chirilgan: ' + Store.roomParam);
    $('#roomsBtn').hidden = false; $('#roomName').textContent = r.name; document.title = r.name + ' — Admin';
    await Store.init();
    start();
  }
  (async () => {
    if (Store.mode === 'supabase') Store.connect(); else await Store.init();   // realtime only after access to the tournament is confirmed
    if (!(await Store.user())) {
      $('#login').hidden = false;
      $('#signUp').addEventListener('click', async () => {
        const f = $('#loginForm');
        if (!f.reportValidity()) return;
        const r = await Store.signUp(f.email.value, f.password.value);
        if (r.error) { $('#loginErr').textContent = r.error; return; }
        if (r.needConfirm) { $('#loginErr').textContent = 'Bu email hali hech qaysi turnirga qo\'shilmagan. Asosiy admin sizni qo\'shgach, qayta ro\'yxatdan o\'ting yoki "Kirish" ni bosing.'; return; }
        $('#login').hidden = true; enter();
      });
      $('#loginForm').addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.target, err = await Store.signIn(f.email.value, f.password.value);
        if (err) { $('#loginErr').textContent = err === 'Email not confirmed' ? 'Bu email hali tasdiqlanmagan yoki turnirga qo\'shilmagan.' : err; return; }
        $('#login').hidden = true; enter();
      });
    } else enter();
  })();
})();
