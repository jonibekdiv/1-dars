/* OBS browser source: renders everything from the shared state */
(() => {
  const { esc } = U;
  const $ = id => document.getElementById(id);
  const q = new URLSearchParams(location.search);
  let cfg = U.defConfig(), live = U.defLive(1), hist = U.normHist(), ix = U.index(cfg);
  let lastLive = '', lastHist = '', seen = null, booted = false;
  const popQ = [], elimQ = [];
  let popBusy = false, elimBusy = false, zoneId = null, zoneEnd = 0, zoneLen = 0, sceneKey = '';
  const rows = {}; let prevElims = {};

  if (q.has('preview')) document.body.classList.add('preview');
  function fit() {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    $('stage').style.transform = `scale(${s})`;
  }
  addEventListener('resize', fit); fit();

  /* Only touch the DOM when the markup really changed: no image flicker, animations keep running */
  function setHtml(el, html) {
    if (el.__h === html) return false;
    el.__h = html; el.innerHTML = html;
    return true;
  }
  const img = (src, cls) => src ? `<img class="${cls || ''}" src="${esc(src)}" alt="">` : '';
  const flag = (t, cls) => img(U.flagUrl(t.flag), cls || 'fl');
  const logo = (t, cls) => t.logo ? img(t.logo, cls || 'lg') : `<div class="nolg ${cls || ''}">${esc((t.tag || '?').slice(0, 4))}</div>`;
  const pips = pl => `<div class="pips">${pl.map(p => `<i class="${p.st === 'd' ? '' : p.st === 'k' ? 'k' : 'a'}"></i>`).join('')}</div>`;

  /* Accent colour and the shades derived from it (computed here so old OBS browsers need no modern CSS) */
  function applyTheme() {
    const m = /^#?([0-9a-f]{6})$/i.exec(cfg.accent || '') || [0, 'ff6a1a'];
    const n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const mix = k => `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const st = document.documentElement.style;
    st.setProperty('--acc', `rgb(${r},${g},${b})`);
    st.setProperty('--acc-d', mix(.62));
    st.setProperty('--acc-dd', mix(.3));
    st.setProperty('--acc-a', `rgba(${r},${g},${b},.26)`);
    st.setProperty('--acc-a2', `rgba(${r},${g},${b},.12)`);
    st.setProperty('--on', lum > .62 ? '#0b1017' : '#ffffff');
  }

  /* ---------- ranking ---------- */
  function renderRank() {
    const el = $('rank');
    const list = U.liveRanking(cfg, live);
    el.classList.toggle('hide', !live.show.ranking || !list.length || !!live.show.scene);
    if (!list.length) return;
    if (!el.firstChild) el.innerHTML = '<div class="rk-lead"></div><div class="rk-head"><span>#</span><span>TEAM</span><span>ALIVE</span><span>ELIMS</span></div><div class="rk-rows"></div><div class="rk-foot"><span><i class="a"></i>ALIVE</span><span><i class="k"></i>KNOCKED</span><span><i></i>ELIMINATED</span></div>';
    const lead = list[0], rest = list.slice(1);
    setHtml(el.querySelector('.rk-lead'),
      `<div class="bdg">#1</div>${logo(lead.t)}<div class="inf"><div class="tg">${flag(lead.t)}<span>${esc(lead.t.tag)}</span></div>${pips(lead.pl)}</div><div class="el"><b>${lead.elims}</b><small>ELIMS</small></div>`);
    const rh = Math.max(20, Math.min(34, Math.floor(690 / Math.max(1, rest.length))));
    el.style.setProperty('--rh', rh + 'px');
    const box = el.querySelector('.rk-rows');
    box.style.height = rest.length * rh + 'px';
    const keep = {};
    rest.forEach((r, i) => {
      let d = rows[r.t.id];
      if (!d) { d = rows[r.t.id] = document.createElement('div'); d.className = 'rk-row'; box.appendChild(d); }
      keep[r.t.id] = 1;
      d.style.top = i * rh + 'px';
      d.classList.toggle('out', r.out);
      d.classList.toggle('odd', i % 2 === 1);
      setHtml(d, `<span class="n">${i + 2}</span>${flag(r.t) || '<span></span>'}${r.t.logo ? img(r.t.logo, 'lg') : '<span></span>'}<span class="tg">${esc(r.t.tag)}</span>${pips(r.pl)}<span class="el">${r.elims}</span>`);
      if (prevElims[r.t.id] !== undefined && r.elims > prevElims[r.t.id]) { d.classList.remove('flash'); void d.offsetWidth; d.classList.add('flash'); }
    });
    Object.keys(rows).forEach(id => { if (!keep[id]) { rows[id].remove(); delete rows[id]; } });
    prevElims = {}; list.forEach(r => { prevElims[r.t.id] = r.elims; });
  }

  /* ---------- final teams ---------- */
  function renderWwcd() {
    const el = $('wwcd');
    const alive = U.liveRanking(cfg, live).filter(r => !r.out);
    const w = r => r.pl.reduce((s, p) => s + (p.st === 'a' ? 1 : p.st === 'k' ? .4 : 0), 0);
    const sum = alive.reduce((s, r) => s + w(r), 0) || 1;
    const list = alive.slice().sort((a, b) => w(b) - w(a) || b.elims - a.elims).slice(0, 5);
    el.classList.toggle('hide', !live.show.wwcd || !list.length || !!live.show.scene);
    setHtml(el, list.map(r => {
      const pc = w(r) / sum * 100;
      return `<div class="wc"><div class="top">${logo(r.t)}<div class="mid"><b>${esc(r.t.tag)}</b>${pips(r.pl)}</div>${flag(r.t)}</div><div class="bot"><i style="width:${pc.toFixed(1)}%"></i><span>WWCD</span><b>${pc.toFixed(1)}%</b></div></div>`;
    }).join(''));
  }

  /* ---------- lower third ---------- */
  let spIdx = 0;
  function renderBase() {
    $('lower').classList.toggle('hide', !live.show.lower || !!live.show.scene);
    const sub = [cfg.stage, 'MATCH ' + live.matchNo, live.map].filter(Boolean).join(' · ');
    const changed = setHtml($('base'), `<div class="lg">${cfg.logo ? img(cfg.logo) : ''}</div><div class="l"><b>${esc(cfg.title)}</b><span>${esc(sub)}</span></div>` +
      (cfg.sponsors.length ? `<div class="sp">${cfg.sponsors.map(s => `<img src="${esc(s)}">`).join('')}</div>` : ''));
    $('base').classList.toggle('nologo', !cfg.logo);
    if (changed) showSponsor();
  }
  function showSponsor() {
    const n = cfg.sponsors.length;
    document.querySelectorAll('#base .sp img').forEach((im, i) => im.classList.toggle('on', n > 0 && i === spIdx % n));
  }
  setInterval(() => { if (cfg.sponsors.length > 1) { spIdx++; showSponsor(); } }, 8000);

  function bannerHtml(b) {
    const pe = b.pid && ix.p[b.pid], t = pe ? pe.t : ix.t[b.tid];
    if (!t) return '';
    const name = pe ? pe.p.name : (t.name || t.tag);
    const pic = pe && pe.p.photo ? img(pe.p.photo, 'photo') : logo(t, 'big');
    const L = {
      airdrop: ['AIRDROP', '<em>LOOTED</em>'],
      sharp: [`${esc(b.v)} <small>MTR</small>`, '<em>SHARPSHOOTER</em>', 1],
      damage: [`<em>${esc(b.v)}</em>`, 'DAMAGE'],
      rampage: ['RAMPAGE', `ELIMS <em>${esc(b.v)}</em>`],
      domination: ['DOMINATION', `ELIMS <em>${esc(b.v)}</em>`],
      stealer: ['ELIM', '<em>STEALER</em>'],
      firstblood: ['FIRST', '<em>BLOOD</em>'],
      custom: [esc(b.l1), `<em>${esc(b.l2)}</em>`, Math.max((b.l1 || '').length, (b.l2 || '').length) > 9]
    }[b.type];
    if (!L) return '';
    return `<div class="bn"><div class="card"><div class="pic">${pic}</div><div class="tx ${L[2] ? 's' : ''}"><b>${L[0]}</b><b>${L[1]}</b></div></div>` +
      `<div class="nm">${pe && t.logo ? img(t.logo, 'tl') : ''}<span class="tt">${esc(pe ? t.tag : '')}</span><span class="nn">${esc(name)}</span>${flag(t)}</div></div>`;
  }
  function nextPop() {
    if (popBusy || !popQ.length) return;
    const b = popQ.shift();
    const html = Date.now() - b._in > 9000 ? '' : bannerHtml(b);   // too late to be relevant: skip
    if (!html) return nextPop();
    popBusy = true;
    const pop = $('pop');
    pop.innerHTML = html; pop.classList.add('on');
    setTimeout(() => { pop.classList.remove('on'); setTimeout(() => { popBusy = false; nextPop(); }, 650); }, popQ.length ? 4200 : 6000);
  }
  function nextElim() {
    if (elimBusy || !elimQ.length) return;
    const b = elimQ.shift(), v = ix.t[b.tid], a = ix.t[b.by];
    if (!v || Date.now() - b._in > 9000) return nextElim();
    elimBusy = true;
    const el = $('telim');
    el.innerHTML = `<div class="te ${a ? '' : 'solo'}">${a ? `<div class="sd">${logo(a)}<span>${esc(a.tag)}</span></div>` : ''}<div class="mid"><b>ELIMINATED</b><span>${a ? '<i></i><i></i><i></i><i></i>' : (b.place ? 'FINISHED #' + esc(b.place) : '')}</span></div><div class="sd v">${logo(v)}<span>${esc(v.tag)}</span></div></div>`;
    el.classList.remove('hide');
    setTimeout(() => { el.classList.add('hide'); setTimeout(() => { elimBusy = false; nextElim(); }, 600); }, elimQ.length ? 3200 : 5000);
  }
  function takeBanners() {
    const first = seen === null;
    if (first) seen = {};
    const fresh = live.banners.filter(b => !seen[b.id]);
    fresh.forEach(b => { seen[b.id] = 1; });
    // Old banners are never replayed: not after a (re)load, and not when a whole backlog
    // arrives at once after a lost connection. Nothing pops over a fullscreen scene either.
    if (!first && fresh.length <= 5 && !live.show.scene) {
      fresh.forEach(b => (b.type === 'teamelim' ? elimQ : popQ).push(Object.assign({ _in: Date.now() }, b)));
    }
    // never fall far behind the game: keep only the newest few
    if (popQ.length > 3) popQ.splice(0, popQ.length - 3);
    if (elimQ.length > 3) elimQ.splice(0, elimQ.length - 3);
    if (live.show.scene) { popQ.length = 0; elimQ.length = 0; $('telim').classList.add('hide'); $('pop').classList.remove('on'); }
    nextPop(); nextElim();
  }

  /* ---------- zone ---------- */
  function takeZone() {
    const z = live.zone;
    if (!z) { zoneId = null; zoneEnd = 0; return; }
    if (z.id === zoneId) return;
    zoneId = z.id; zoneLen = z.sec;
    // A zone that arrives while we are running starts a local countdown, so a clock difference
    // between the admin PC and the OBS PC does not matter. Only after a reload do we trust timestamps.
    zoneEnd = booted ? Date.now() + z.sec * 1000 : z.at + z.sec * 1000;
  }
  let lastTick = -1;
  setInterval(() => {
    const el = $('zone'), left = Math.ceil((zoneEnd - Date.now()) / 1000);
    const showAt = Math.min(cfg.zoneShowAt || 10, zoneLen || 10);
    const on = zoneEnd && left > 0 && left <= showAt && !live.show.scene;
    el.classList.toggle('hide', !on);
    if (on && left !== lastTick) {
      lastTick = left;
      const C = 2 * Math.PI * 38, off = C * (1 - left / showAt);
      el.innerHTML = `<div class="t"><span>CIRCLE</span><span>CLOSING IN</span></div><div class="c"><svg viewBox="0 0 90 90"><circle cx="45" cy="45" r="38" class="bg"/><circle cx="45" cy="45" r="38" class="fg" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/></svg><b class="tick">${left}</b></div>`;
    }
  }, 200);

  /* ---------- fullscreen scenes ---------- */
  function head(h1, h2) {
    return `<div class="deco"></div><div class="brand">${img(cfg.logo)}<span>${esc(cfg.title)}</span></div><div class="hd"><h1>${esc(h1)}</h1><h2>${esc(h2)}</h2></div>`;
  }
  function table(list, cols) {
    const n = list.length, two = n > 10, per = two ? Math.ceil(n / 2) : n;
    const th = Math.max(34, Math.min(70, Math.floor(690 / (per + 1))));
    const hd = `<div class="tr h"><span>RANK</span><span></span><span></span><span class="nm">TEAM</span>${cols.map(c => `<span>${c[0]}</span>`).join('')}</div>`;
    const row = (r, i) => `<div class="tr ${i < 3 ? 'top' + (i + 1) : ''}" style="animation-delay:${i * 35}ms"><span class="rk">${i + 1}</span>${flag(r.t) || '<span></span>'}${r.t.logo ? img(r.t.logo, 'lg') : '<span></span>'}<span class="nm">${esc(two ? (r.t.tag || r.t.name) : (r.t.name || r.t.tag))}</span>${cols.map(c => `<span class="${c[2] || ''}">${c[1](r)}</span>`).join('')}</div>`;
    const colHtml = part => `<div>${hd}${part.map(x => row(x.r, x.i)).join('')}</div>`;
    const items = list.map((r, i) => ({ r, i }));
    return `<div class="tb ${two ? 'two' : ''}" style="--th:${th}px">${colHtml(items.slice(0, per))}${two ? colHtml(items.slice(per)) : ''}</div>`;
  }
  function playerCard(pid, i, withTeam) {
    const e = ix.p[pid]; if (!e) return '';
    const tot = U.playerTotals(cfg, hist, live)[pid] || { k: 0, kn: 0, dmg: 0, surv: 0, n: 0 };
    return `<div class="pc" style="animation-delay:${i * 90}ms"><div class="ph">${e.p.photo ? img(e.p.photo) : logo(e.t, 'wm')}${withTeam ? `<div class="rkn">#${i + 1}</div>` : ''}</div><div class="nm">${esc(e.p.name)}</div>` +
      (withTeam ? `<div class="tm">${e.t.logo ? img(e.t.logo) : ''}${esc(e.t.tag)}</div>` : '') +
      `<dl><div>ELIMS<dd>${tot.k}</dd></div><div>DAMAGE<dd>${Math.round(tot.dmg)}</dd></div><div>KNOCKS<dd>${tot.kn}</dd></div><div>AVG. SURV.<dd>${tot.n ? U.mmss(tot.surv / tot.n) : '--:--'}</dd></div></dl></div>`;
  }
  function sceneHtml() {
    const s = live.show.scene, t = ix.t[live.show.sceneTeam];
    const wwcd = r => r.wwcd ? '<i class="ck"></i>' : '–';
    if (s === 'results') {
      const used = Object.keys(live.players).length || !hist.matches.length ? live : hist.matches[hist.matches.length - 1];
      const no = used === live ? live.matchNo : used.no, map = used === live ? live.map : used.map;
      return `<div class="sc">${head('MATCH RESULTS', [cfg.stage, 'MATCH ' + no, map].filter(Boolean).join(' · '))}${table(U.matchRows(cfg, used), [['WWCD', wwcd], ['PLACE PTS', r => r.pp], ['ELIMS', r => r.elims], ['TOTAL', r => r.total, 'tot']])}</div>`;
    }
    if (s === 'overall') {
      return `<div class="sc">${head('OVERALL RANKING', [cfg.stage, 'POST MATCH ' + hist.matches.length].filter(Boolean).join(' · '))}${table(U.overall(cfg, hist), [['WWCD', r => r.wwcd], ['PLACE PTS', r => r.pp], ['ELIMS', r => r.elims], ['TOTAL', r => r.total, 'tot']])}</div>`;
    }
    if (s === 'team' && t) {
      return `<div class="sc">${head(t.name || t.tag, 'TEAM PERFORMANCE')}<div class="cards"><div class="side">${logo(t)}${flag(t)}</div>${t.players.map((p, i) => playerCard(p.id, i)).join('')}</div></div>`;
    }
    if (s === 'mvp') {
      const tot = U.playerTotals(cfg, hist, live);
      const top = Object.keys(tot).filter(id => ix.p[id]).sort((a, b) => (tot[b].k - tot[a].k) || (tot[b].dmg - tot[a].dmg) || (tot[b].kn - tot[a].kn)).slice(0, 5);
      return `<div class="sc">${head('TOP FRAGGERS', cfg.stage)}<div class="cards">${top.map((id, i) => playerCard(id, i, true)).join('')}</div></div>`;
    }
    if (s === 'champion' && t) {
      return `<div class="champ"><div class="rays"></div><div class="k">CHAMPION OF THE MATCH</div><div class="bd">${logo(t)}</div><div class="n">${esc(t.name || t.tag)}</div><div class="s">WINNER WINNER CHICKEN DINNER · MATCH ${live.matchNo}</div></div>`;
    }
    return '';
  }
  function renderScene() {
    const el = $('scene'), s = live.show.scene;
    if (!s) { sceneKey = ''; el.classList.remove('on'); return; }
    const html = sceneHtml();
    const same = sceneKey === s + '|' + live.show.sceneTeam;   // same scene, only numbers changed
    sceneKey = s + '|' + live.show.sceneTeam;
    if (setHtml(el, html) && same) el.querySelectorAll('.tr,.pc,.champ *').forEach(n => { n.style.animation = 'none'; });
    el.classList.toggle('on', !!html);
  }

  function renderAll() { renderRank(); renderWwcd(); renderBase(); renderScene(); }

  Store.on('config', d => { cfg = U.normConfig(d); ix = U.index(cfg); applyTheme(); renderAll(); });
  Store.on('history', d => { const s = JSON.stringify(d); if (s === lastHist) return; lastHist = s; hist = U.normHist(d); renderScene(); });
  Store.on('live', d => {
    const s = JSON.stringify(d);
    if (s === lastLive) return;
    lastLive = s; live = U.normLive(d);
    takeBanners(); takeZone(); renderAll();
  });

  (async () => {
    applyTheme();
    await Store.init();
    const [c, l, h] = await Promise.all([Store.load('config'), Store.load('live'), Store.load('history')]);
    cfg = U.normConfig(c); ix = U.index(cfg); hist = U.normHist(h); lastHist = JSON.stringify(h);
    live = U.normLive(l); lastLive = JSON.stringify(l);
    applyTheme(); takeBanners(); takeZone(); renderAll();
    booted = true;
    Store.poll(7000);
  })();
})();
