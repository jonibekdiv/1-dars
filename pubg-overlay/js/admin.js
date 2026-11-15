/* Admin panel: every click updates the shared state, the overlay follows in real time */
(() => {
  const { esc } = U;
  const $ = s => document.querySelector(s);
  const me = U.uid();
  let cfg = U.defConfig(), live = U.defLive(1), hist = U.normHist(), ix = U.index(cfg);
  let tab = 'live', sel = null, filter = '', undo = [], lastKillTeam = null;
  const ui = { zone: 30, dist: 300, dmg: 500, c1: '', c2: '', team: '' };

  /* ---------- persistence ---------- */
  const saveCfg = () => { cfg._w = me; ix = U.index(cfg); Store.set('config', cfg); };
  const saveLive = () => { live._w = me; live._s = (live._s || 0) + 1; Store.set('live', live); };
  const saveHist = () => { hist._w = me; Store.set('history', hist); };

  const P = pid => live.players[pid] || (live.players[pid] = { k: 0, kn: 0, dmg: 0, st: 'a' });
  const teamOf = pid => ix.p[pid] && ix.p[pid].t;
  const elapsed = () => live.startedAt ? Math.round((Date.now() - live.startedAt) / 1000) : 0;
  const activeTeams = () => cfg.teams.filter(t => t.players.length);

  /* Run a change to the live match: snapshot for undo, apply, recompute, save, redraw */
  function act(fn) {
    undo.push(JSON.stringify(live)); if (undo.length > 60) undo.shift();
    lastKillTeam = null;
    fn();
    settle();
    saveLive(); render();
  }
  function banner(b) {
    live.banners.push(Object.assign({ id: U.uid(), ts: Date.now() }, b));
    if (live.banners.length > 12) live.banners.splice(0, live.banners.length - 12);
  }

  /* Team placements follow automatically from player statuses */
  function settle() {
    const teams = activeTeams();
    const st = t => ({ t, tl: U.teamLive(cfg, live, t), rec: live.teams[t.id] || (live.teams[t.id] = {}) });
    const all = teams.map(st);
    // a team that is alive again (correction) loses its automatic placement
    all.forEach(x => { if (x.rec.place && !x.rec.m && !x.tl.out && x.rec.place !== 1) delete x.rec.place; });
    all.filter(x => x.tl.out && !x.rec.place).forEach(x => {
      x.rec.place = all.filter(y => !y.rec.place).length;
      if (cfg.auto.teamElim) banner({ type: 'teamelim', tid: x.t.id, by: lastKillTeam && lastKillTeam !== x.t.id ? lastKillTeam : null, place: x.rec.place });
    });
    // automatic winner: the single team left standing
    all.forEach(x => { if (x.rec.place === 1 && !x.rec.m && (x.tl.out || all.some(y => y !== x && !y.rec.place))) delete x.rec.place; });
    const left = all.filter(x => !x.rec.place);
    if (left.length === 1 && teams.length > 1 && !left[0].tl.out) left[0].rec.place = 1;
  }

  /* ---------- kill / knock logic ---------- */
  const attackerFor = vt => (sel && teamOf(sel) && teamOf(sel).id !== vt.id) ? sel : null;

  function die(pid, credit) {
    const v = P(pid), knocker = v.by;
    v.st = 'd'; v.dt = elapsed(); delete v.by;
    if (!credit || !ix.p[credit]) return;
    const A = P(credit), at = teamOf(credit);
    A.k++; lastKillTeam = at.id;
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
    t.players.forEach(p => { const s = P(p.id); if (s.st === 'k') die(p.id, s.by); });
  }
  function knock(pid) {
    act(() => {
      const v = P(pid), vt = teamOf(pid);
      if (v.st === 'd') return;
      if (v.st === 'k') { v.st = 'a'; delete v.by; return; }
      v.st = 'k';
      const a = attackerFor(vt);
      if (a) { v.by = a; P(a).kn++; } else delete v.by;
      wipeCheck(vt);
    });
  }
  function kill(pid) {
    act(() => {
      const v = P(pid), vt = teamOf(pid);
      if (v.st === 'd') { v.st = 'a'; delete v.dt; return; }
      die(pid, attackerFor(vt) || v.by);
      wipeCheck(vt);
    });
  }

  /* ---------- images ---------- */
  function readImage(file, max) {
    return new Promise(res => {
      const im = new Image();
      im.onload = () => {
        const s = Math.min(1, max / Math.max(im.width, im.height));
        const c = document.createElement('canvas');
        c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(im.src);
        res(c.toDataURL('image/webp', .85));
      };
      im.onerror = () => res('');
      im.src = URL.createObjectURL(file);
    });
  }
  const up = (src, act, id, label) => `<span class="up" title="${label || 'Rasm yuklash'}">${src ? `<img src="${esc(src)}">` : '+'}<input type="file" accept="image/*" data-c="${act}" data-id="${id || ''}"></span>`;

  /* ---------- LIVE tab ---------- */
  function gridHtml() {
    const f = filter.trim().toLowerCase();
    return cfg.teams.map(t => {
      const tl = U.teamLive(cfg, live, t);
      const hit = !f || (t.tag + ' ' + t.name + ' ' + t.players.map(p => p.name).join(' ')).toLowerCase().includes(f);
      return `<div class="tc ${tl.out ? 'out' : ''} ${hit ? '' : 'dim'}"><div class="hd">${t.logo ? `<img src="${esc(t.logo)}">` : ''}<span>${esc(t.tag)}</span>` +
        (tl.place ? `<span class="pl ${tl.place === 1 ? 'w' : ''}">#${tl.place}</span>` : '') + `<span class="el">${tl.elims}</span></div>` +
        tl.pl.map(p => `<div class="pr ${p.st}"><button class="nm ${sel === p.id ? 'sel' : ''}" data-a="sel" data-id="${p.id}">${esc(p.name)}</button>` +
          `<button class="mini" data-a="km" data-id="${p.id}">−</button><span class="k">${p.k || 0}</span><button class="mini" data-a="kp" data-id="${p.id}">+</button>` +
          `<button class="bk ${p.st === 'k' ? 'on' : ''}" data-a="knock" data-id="${p.id}" title="Nok">N</button><button class="bd ${p.st === 'd' ? 'on' : ''}" data-a="kill" data-id="${p.id}" title="O'ldi">☠</button></div>`).join('') + '</div>';
    }).join('') || '<div class="box">Jamoalar yo\'q. "Jamoalar" bo\'limida qo\'shing.</div>';
  }
  function sideHtml() {
    const se = sel && ix.p[sel], sh = live.show;
    const tg = (k, l) => `<button class="${sh[k] ? 'on' : ''}" data-a="show" data-v="${k}">${l}</button>`;
    const sc = (k, l) => `<button class="${sh.scene === k ? 'on' : ''}" data-a="scene" data-v="${k}">${l}</button>`;
    const dis = se ? '' : 'disabled';
    const winner = cfg.teams.find(t => (live.teams[t.id] || {}).place === 1);
    const tid = ui.team || (winner && winner.id) || (se && se.t.id) || '';
    return `<div class="atk ${se ? 'has' : ''}">${se ? `<span class="hint">TANLANGAN (hujumchi) — Esc bilan bekor</span><b>${esc(se.t.tag)} · ${esc(se.p.name)}</b>` :
      '<span class="hint">O\'yinchi ismini bosing → keyin qurbonning <b style="display:inline;font-size:inherit">N</b> (nok) yoki <b style="display:inline;font-size:inherit">☠</b> (kill) tugmasini bosing. Tanlanmagan bo\'lsa — zonadan o\'lim (kill hech kimga yozilmaydi).</span>'}</div>
    <input id="filter" placeholder="Qidirish: jamoa yoki o'yinchi…" value="${esc(filter)}" style="width:100%;margin-bottom:10px">
    <div class="box"><h3>Ekranda ko'rsatish</h3><div class="g3">${tg('ranking', 'Reyting')}${tg('lower', 'Pastki banner')}${tg('wwcd', 'Final jamoalar')}</div></div>
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
      <div class="g2" style="margin-bottom:6px">${sc('results', 'Match natijasi')}${sc('overall', 'Umumiy reyting')}${sc('mvp', 'Top fraggers')}<button data-a="scene" data-v="" class="${sh.scene ? 'dng' : ''}">Sahnani yopish</button></div>
      <div class="row"><select data-u="team" style="flex:1"><option value="">Jamoa…</option>${cfg.teams.map(t => `<option value="${t.id}" ${t.id === tid ? 'selected' : ''}>${esc(t.tag)} — ${esc(t.name)}</option>`).join('')}</select></div>
      <div class="g2">${sc('team', 'Jamoa statistikasi')}${sc('champion', '🏆 Chempion')}</div></div>
    <div class="box"><h3>Match</h3>
      <div class="row"><label>№<input type="number" data-l="matchNo" value="${live.matchNo}" style="width:60px"></label><label style="flex:1">Xarita<input data-l="map" value="${esc(live.map)}"></label></div>
      <div class="g2"><button data-a="timer" class="${live.startedAt ? '' : 'pri'}">${live.startedAt ? 'Taymerni qayta boshlash' : '▶ Match boshlandi'}</button><button data-a="finish" class="pri">✔ Matchni yakunlash</button></div>
      <p class="hint">Yakunlashda natija saqlanadi va yangi match ochiladi.</p></div>`;
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

  /* ---------- RESULTS tab ---------- */
  function tbl(rows, live_) {
    return `<table><tr><th>#</th><th class="l">Jamoa</th><th>O'rin</th><th>O'rin ochko</th><th>Kill</th><th>Jami</th></tr>${rows.map((r, i) =>
      `<tr><td>${i + 1}</td><td class="l">${esc(r.t.tag)} — ${esc(r.t.name)}</td><td>${live_ ? `<input type="number" min="1" data-place="${r.t.id}" value="${r.place || ''}">` : (r.place || '-')}</td><td>${r.pp}</td><td>${r.elims}</td><td><b>${r.total}</b></td></tr>`).join('')}</table>`;
  }
  function resultsHtml() {
    const tot = U.playerTotals(cfg, hist, null);
    const ov = U.overall(cfg, hist);
    const players = Object.keys(ix.p).map(id => ({ id, e: ix.p[id], s: tot[id] || { k: 0, kn: 0, dmg: 0, surv: 0, n: 0 } })).sort((a, b) => b.s.k - a.s.k || b.s.dmg - a.s.dmg);
    return `<div class="cols"><div class="box"><h3>Joriy match №${live.matchNo} (o'rinni qo'lda tuzatish mumkin)</h3>${tbl(U.matchRows(cfg, live), true)}</div>
      <div class="box"><h3>Joriy match — o'yinchi damage (ixtiyoriy)</h3><table><tr><th class="l">O'yinchi</th><th>Kill</th><th>Nok</th><th>Damage</th></tr>
      ${cfg.teams.map(t => t.players.map(p => { const s = U.P(live, p.id); return `<tr><td class="l">${esc(t.tag)} · ${esc(p.name)}</td><td>${s.k || 0}</td><td>${s.kn || 0}</td><td><input type="number" data-dmg="${p.id}" value="${s.dmg || ''}"></td></tr>`; }).join('')).join('')}</table></div></div>
    <div class="cols"><div class="box"><h3>Umumiy reyting (${hist.matches.length} match)</h3>
      <table><tr><th>#</th><th class="l">Jamoa</th><th>WWCD</th><th>O'rin ochko</th><th>Kill</th><th>Jami</th></tr>${ov.map((r, i) => `<tr><td>${i + 1}</td><td class="l">${esc(r.t.tag)} — ${esc(r.t.name)}</td><td>${r.wwcd}</td><td>${r.pp}</td><td>${r.elims}</td><td><b>${r.total}</b></td></tr>`).join('')}</table>
      <div class="row" style="margin-top:10px"><button data-a="csvTeams">CSV: jamoalar</button><button data-a="csvPlayers">CSV: o'yinchilar</button></div></div>
      <div class="box"><h3>O'yinchilar (yakunlangan matchlar)</h3><table><tr><th>#</th><th class="l">O'yinchi</th><th>Kill</th><th>Nok</th><th>Damage</th><th>O'rt. yashash</th></tr>
      ${players.slice(0, 30).map((x, i) => `<tr><td>${i + 1}</td><td class="l">${esc(x.e.t.tag)} · ${esc(x.e.p.name)}</td><td>${x.s.k}</td><td>${x.s.kn}</td><td>${Math.round(x.s.dmg)}</td><td>${x.s.n ? U.mmss(x.s.surv / x.s.n) : '-'}</td></tr>`).join('')}</table></div></div>
    <div class="box"><h3>Yakunlangan matchlar</h3>${hist.matches.map((m, i) => `<details><summary>Match ${m.no} — ${esc(m.map || '')} <button class="dng" data-a="delMatch" data-id="${i}">O'chirish</button></summary>${tbl(U.matchRows(cfg, m))}</details>`).join('') || '<p class="hint">Hali yo\'q.</p>'}</div>`;
  }

  /* ---------- SETTINGS tab ---------- */
  function settingsHtml() {
    const base = location.href.replace(/admin\.html.*$/, '');
    const url = `${base}overlay.html${Store.room !== 'main' ? '?room=' + encodeURIComponent(Store.room) : ''}`;
    return `<div class="cols"><div class="box"><h3>Brend</h3>
      <div class="row"><span style="width:64px">${up(cfg.logo, 'logo', '', 'Turnir logosi')}</span><div style="flex:1"><label>Turnir nomi<input data-g="title" value="${esc(cfg.title)}"></label><label style="margin-top:6px">Bosqich<input data-g="stage" value="${esc(cfg.stage)}"></label></div></div>
      <div class="row"><label>Asosiy rang<input type="color" data-g="accent" value="${esc(cfg.accent)}"></label></div>
      <h3 style="margin-top:12px">Homiylar (pastki bannerda almashib turadi)</h3>
      <div class="spn">${cfg.sponsors.map((s, i) => `<span class="up"><img src="${esc(s)}"><button class="dng" data-a="delSp" data-id="${i}" style="position:absolute;right:2px;top:2px;padding:0 6px">✕</button></span>`).join('')}${up('', 'sponsor', '', 'Homiy logosi')}</div></div>
    <div class="box"><h3>Ochkolar</h3><label>O'rin ochkolari (1-o'rindan boshlab, vergul bilan)<input data-g="place" value="${cfg.points.place.join(', ')}"></label>
      <label style="margin-top:6px">Har bir kill uchun<input type="number" data-g="kill" value="${cfg.points.kill}"></label>
      <h3 style="margin-top:12px">Avtomatik bannerlar</h3>
      <div class="row"><label><span><input type="checkbox" data-g="teamElim" ${cfg.auto.teamElim ? 'checked' : ''}> Jamoa yopilganda "ELIMINATED"</span></label></div>
      <div class="row"><label><span><input type="checkbox" data-g="stealer" ${cfg.auto.stealer ? 'checked' : ''}> Boshqa jamoa nokini o'ldirsa "ELIM STEALER"</span></label></div>
      <div class="row"><label><span><input type="checkbox" data-g="firstBlood" ${cfg.auto.firstBlood ? 'checked' : ''}> Birinchi kill "FIRST BLOOD"</span></label></div>
      <div class="row"><label>Rampage (o'yinchi killi, 0 = o'chiq)<input type="number" data-g="rampage" value="${cfg.auto.rampage}"></label><label>Domination (jamoa killi)<input type="number" data-g="domination" value="${cfg.auto.domination}"></label><label>Zona banneri (sek)<input type="number" data-g="zoneShowAt" value="${cfg.zoneShowAt}"></label></div></div></div>
    <div class="box"><h3>OBS ga ulash</h3><p>OBS → Sources → <b>Browser</b> → URL: <code>${esc(url)}</code> · Width <b>1920</b>, Height <b>1080</b>.</p>
      <div class="row"><button data-a="copy" data-v="${esc(url)}">URL nusxalash</button><a href="${esc(url)}${url.includes('?') ? '&' : '?'}preview" target="_blank"><button>Ko'rib chiqish (fon bilan)</button></a></div>
      <p class="hint">Rejim: <b>${Store.mode === 'supabase' ? 'Internet (Supabase)' : 'Lokal — faqat shu brauzerda ishlaydi. OBS bilan ishlashi uchun README dagi Supabase sozlamasini bajaring.'}</b> · Xona: <b>${esc(Store.room)}</b></p></div>
    <div class="box"><h3>Xavfli zona</h3><div class="row"><button class="dng" data-a="resetMatch">Joriy matchni tozalash</button><button class="dng" data-a="resetHist">Barcha natijalarni o'chirish</button>${Store.mode === 'supabase' ? '<button data-a="logout">Chiqish</button>' : ''}</div></div>`;
  }

  function render() {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === tab));
    $('#undo').disabled = !undo.length;
    const m = $('#main');
    if (tab === 'live') {
      if (!$('#grid')) m.innerHTML = '<div class="live"><div id="grid"></div><aside id="side"></aside></div>';
      $('#grid').innerHTML = gridHtml();
      const a = document.activeElement, keepFocus = a && a.closest && a.closest('#side') && /INPUT|SELECT/.test(a.tagName);
      if (!keepFocus) $('#side').innerHTML = sideHtml();
    } else {
      const y = scrollY;
      m.innerHTML = tab === 'teams' ? teamsHtml() : tab === 'results' ? resultsHtml() : settingsHtml();
      scrollTo(0, y);
    }
  }

  /* ---------- actions ---------- */
  function finish() {
    const rows = U.liveRanking(cfg, live);
    if (!rows.length) return;
    if (!confirm(`Match ${live.matchNo} yakunlansinmi? Natija saqlanadi va yangi match ochiladi.`)) return;
    const dur = elapsed();
    // teams still without a placement get the best free places, by players alive then elims
    const used = new Set(rows.map(r => r.place).filter(Boolean));
    let next = 1;
    rows.filter(r => !r.place).sort((a, b) => b.alive - a.alive || b.elims - a.elims).forEach(r => {
      while (used.has(next)) next++;
      r.place = next; used.add(next);
    });
    const rec = { no: live.matchNo, map: live.map, teams: {}, players: {} };
    rows.forEach(r => {
      rec.teams[r.t.id] = { place: r.place, elims: r.elims };
      r.pl.forEach(p => { rec.players[p.id] = { k: p.k || 0, kn: p.kn || 0, dmg: +p.dmg || 0, surv: p.st === 'd' ? (p.dt || 0) : dur }; });
    });
    hist.matches.push(rec); saveHist();
    const n = U.defLive(live.matchNo + 1);
    n.map = live.map; n.show = Object.assign({}, live.show, { scene: live.show.scene === 'champion' ? null : live.show.scene, wwcd: false });
    n._s = live._s;
    live = n; undo = []; sel = null;
    saveLive(); tab = 'results'; render();
  }
  function csv(name, rows) {
    const txt = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + txt], { type: 'text/csv' }));
    a.download = name; a.click();
  }
  function newTeam(tag, name, flag, players) {
    return { id: U.uid(), tag: tag || 'TAG', name: name || '', flag: flag || '', logo: '', players: (players || ['Player 1', 'Player 2', 'Player 3', 'Player 4']).map(n => ({ id: U.uid(), name: n, photo: '' })) };
  }

  const A = {
    tab(d) { tab = d.v; $('#main').innerHTML = ''; render(); },
    undo() { if (!undo.length) return; live = U.normLive(JSON.parse(undo.pop())); saveLive(); render(); },
    sel(d) { sel = sel === d.id ? null : d.id; render(); },
    kp(d) { act(() => { P(d.id).k++; }); },
    km(d) { act(() => { const p = P(d.id); p.k = Math.max(0, (p.k || 0) - 1); }); },
    knock(d) { knock(d.id); },
    kill(d) { kill(d.id); },
    show(d) { act(() => { live.show[d.v] = !live.show[d.v]; }); },
    scene(d) {
      const winner = cfg.teams.find(t => (live.teams[t.id] || {}).place === 1);
      const tid = ui.team || (winner && winner.id) || (sel && teamOf(sel) && teamOf(sel).id) || null;
      if ((d.v === 'team' || d.v === 'champion') && !tid) return alert('Avval jamoani tanlang');
      act(() => { live.show.scene = live.show.scene === d.v ? null : (d.v || null); live.show.sceneTeam = tid; });
    },
    zone() { act(() => { live.zone = { id: U.uid(), sec: Math.max(1, +ui.zone || 30), at: Date.now() }; }); },
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
    delSp(d) { cfg.sponsors.splice(+d.id, 1); saveCfg(); render(); },
    delMatch(d) { if (!confirm('Bu match natijasi o\'chirilsinmi?')) return; hist.matches.splice(+d.id, 1); saveHist(); render(); },
    resetMatch() { if (!confirm('Joriy match tozalansinmi?')) return; act(() => { const n = U.defLive(live.matchNo); n.map = live.map; n._s = live._s; live = n; }); },
    resetHist() { if (!confirm('BARCHA yakunlangan matchlar o\'chirilsinmi?')) return; hist = U.normHist(); saveHist(); act(() => { live.matchNo = 1; }); },
    copy(d) { navigator.clipboard && navigator.clipboard.writeText(d.v); },
    async logout() { await Store.signOut(); location.reload(); },
    csvTeams() { csv('standings.csv', [['Rank', 'Tag', 'Team', 'WWCD', 'Place pts', 'Elims', 'Total']].concat(U.overall(cfg, hist).map((r, i) => [i + 1, r.t.tag, r.t.name, r.wwcd, r.pp, r.elims, r.total]))); },
    csvPlayers() {
      const tot = U.playerTotals(cfg, hist, null);
      csv('players.csv', [['Team', 'Player', 'Elims', 'Knocks', 'Damage', 'Matches', 'Avg survival']].concat(Object.keys(ix.p).map(id => { const s = tot[id] || { k: 0, kn: 0, dmg: 0, surv: 0, n: 0 }; return [ix.p[id].t.tag, ix.p[id].p.name, s.k, s.kn, Math.round(s.dmg), s.n, s.n ? U.mmss(s.surv / s.n) : '']; })));
    }
  };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-a]');
    if (el && A[el.dataset.a]) { if (el.closest('summary')) e.preventDefault(); A[el.dataset.a](el.dataset); }
  });
  document.addEventListener('input', e => {
    const el = e.target, d = el.dataset;
    if (el.id === 'filter') { filter = el.value; $('#grid').innerHTML = gridHtml(); }
    else if (d.u) ui[d.u] = el.value;
  });
  document.addEventListener('change', async e => {
    const el = e.target, d = el.dataset;
    if (d.c) { // image uploads
      const f = el.files[0]; if (!f) return;
      const big = d.c === 'pphoto' || d.c === 'sponsor';
      const src = await readImage(f, big ? 300 : 200);
      if (!src) return alert('Rasm o\'qilmadi');
      if (d.c === 'tlogo') ix.t[d.id].logo = src;
      else if (d.c === 'pphoto') ix.p[d.id].p.photo = src;
      else if (d.c === 'logo') cfg.logo = src;
      else if (d.c === 'sponsor') cfg.sponsors.push(src);
      saveCfg(); render();
    } else if (d.t) { ix.t[d.id][d.t] = d.t === 'name' ? el.value : d.t === 'tag' ? el.value.toUpperCase() : el.value.toLowerCase(); saveCfg(); }
    else if (d.p) { ix.p[d.id].p.name = el.value; saveCfg(); }
    else if (d.l) { undo.push(JSON.stringify(live)); live[d.l] = d.l === 'matchNo' ? Math.max(1, +el.value || 1) : el.value.toUpperCase(); saveLive(); }
    else if (d.place) { act(() => { const r = live.teams[d.place] || (live.teams[d.place] = {}); if (+el.value > 0) { r.place = +el.value; r.m = 1; } else { delete r.place; delete r.m; } }); }
    else if (d.dmg) { undo.push(JSON.stringify(live)); P(d.dmg).dmg = +el.value || 0; saveLive(); }
    else if (d.g) {
      const k = d.g;
      if (k === 'place') cfg.points.place = el.value.split(',').map(s => +s.trim() || 0);
      else if (k === 'kill') cfg.points.kill = +el.value || 0;
      else if (k === 'teamElim' || k === 'stealer' || k === 'firstBlood') cfg.auto[k] = el.checked;
      else if (k === 'rampage' || k === 'domination') cfg.auto[k] = +el.value || 0;
      else if (k === 'zoneShowAt') cfg.zoneShowAt = Math.max(1, +el.value || 10);
      else cfg[k] = k === 'accent' ? el.value : el.value.toUpperCase();
      saveCfg();
    }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sel) { sel = null; render(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); A.undo(); }
  });
  setInterval(() => { $('#clock').textContent = U.mmss(elapsed()); }, 500);

  /* ---------- boot ---------- */
  Store.onStatus((s, msg) => {
    const el = $('#status');
    el.className = 'st ' + s;
    el.textContent = s === 'ok' ? '● Ulangan' : s === 'local' ? '● Lokal rejim' : '● ' + (msg || 'Xato');
  });
  Store.on('config', d => { if (d._w !== me) { cfg = U.normConfig(d); ix = U.index(cfg); render(); } });
  Store.on('live', d => { if (d._w !== me) { live = U.normLive(d); render(); } });
  Store.on('history', d => { if (d._w !== me) { hist = U.normHist(d); render(); } });

  async function start() {
    const [c, l, h] = await Promise.all([Store.load('config'), Store.load('live'), Store.load('history')]);
    cfg = U.normConfig(c); ix = U.index(cfg); live = U.normLive(l); hist = U.normHist(h);
    if (!cfg.teams.length) tab = 'teams';
    render();
  }
  (async () => {
    await Store.init();
    if (!(await Store.user())) {
      $('#login').hidden = false;
      $('#loginForm').addEventListener('submit', async e => {
        e.preventDefault();
        const f = e.target, err = await Store.signIn(f.email.value, f.password.value);
        if (err) { $('#loginErr').textContent = err; return; }
        $('#login').hidden = true; start();
      });
    } else start();
  })();
})();
