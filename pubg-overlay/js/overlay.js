/* OBS browser source: renders everything from the shared state */
(() => {
  const { esc } = U;
  const $ = id => document.getElementById(id);
  const q = new URLSearchParams(location.search);
  let cfg = U.defConfig(), live = U.defLive(1), hist = U.normHist(), ix = U.index(cfg);
  let lastLive = '', lastHist = '', seen = null;
  const popQ = [], elimQ = [];
  let popBusy = false, elimBusy = false, zoneId = null, zoneEnd = 0, sceneKey = '';
  const rows = {}; let prevElims = {};

  if (q.has('preview')) document.body.classList.add('preview');
  function fit() {
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    $('stage').style.transform = `scale(${s})`;
  }
  addEventListener('resize', fit); fit();

  const img = (src, cls) => src ? `<img class="${cls || ''}" src="${esc(src)}" alt="">` : '';
  const flag = (t, cls) => img(U.flagUrl(t.flag), cls || 'fl');
  const logo = (t, cls) => t.logo ? img(t.logo, cls || 'lg') : `<div class="nolg">${esc((t.tag || '?').slice(0, 3))}</div>`;
  const pips = pl => `<div class="pips">${pl.map(p => `<i class="${p.st === 'd' ? '' : p.st === 'k' ? 'k' : 'a'}"></i>`).join('')}</div>`;

  /* ---------- ranking ---------- */
  function renderRank() {
    const el = $('rank');
    const list = U.liveRanking(cfg, live);
    el.classList.toggle('hide', !live.show.ranking || !list.length || !!live.show.scene);
    if (!list.length) return;
    if (!el.firstChild) el.innerHTML = '<div class="rk-lead"></div><div class="rk-head"><span>#</span><span>TEAM</span><span>ALIVE</span><span>ELIMS</span></div><div class="rk-rows"></div><div class="rk-foot"><span><i style="background:var(--ok)"></i>ALIVE</span><span><i style="background:var(--bad)"></i>KNOCKED</span><span><i style="background:rgba(255,255,255,.3)"></i>ELIMINATED</span></div>';
    const lead = list[0], rest = list.slice(1);
    el.querySelector('.rk-lead').innerHTML =
      `<div class="n">#1</div>${logo(lead.t)}<div><div class="tg">${flag(lead.t)}${esc(lead.t.tag)}</div><div class="ln">${pips(lead.pl)}<div class="el">${lead.elims}<small>ELIMS</small></div></div></div>`;
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
      d.innerHTML = `<span class="n">${i + 2}</span>${flag(r.t) || '<span></span>'}${r.t.logo ? img(r.t.logo, 'lg') : '<span></span>'}<span class="tg">${esc(r.t.tag)}</span>${pips(r.pl)}<span class="el">${r.elims}</span>`;
      if (prevElims[r.t.id] !== undefined && r.elims > prevElims[r.t.id]) { d.classList.remove('flash'); void d.offsetWidth; d.classList.add('flash'); }
    });
    Object.keys(rows).forEach(id => { if (!keep[id]) { rows[id].remove(); delete rows[id]; } });
    prevElims = {}; list.forEach(r => { prevElims[r.t.id] = r.elims; });
  }

  /* ---------- final teams ---------- */
  function renderWwcd() {
    const el = $('wwcd');
    const list = U.liveRanking(cfg, live).filter(r => !r.out).slice(0, 5);
    const w = r => r.pl.reduce((s, p) => s + (p.st === 'a' ? 1 : p.st === 'k' ? .4 : 0), 0);
    const sum = list.reduce((s, r) => s + w(r), 0) || 1;
    el.classList.toggle('hide', !live.show.wwcd || !list.length || !!live.show.scene);
    el.innerHTML = list.map(r =>
      `<div class="wc"><div class="top">${flag(r.t)}${r.t.logo ? img(r.t.logo, 'lg') : ''}<b>${esc(r.t.tag)}</b>${pips(r.pl)}</div><div class="bot"><span>WWCD</span>${(w(r) / sum * 100).toFixed(1)}%</div></div>`).join('');
  }

  /* ---------- lower third ---------- */
  let spIdx = 0;
  function renderBase() {
    $('lower').classList.toggle('hide', !live.show.lower || !!live.show.scene);
    const sub = [cfg.stage, 'MATCH ' + live.matchNo, live.map].filter(Boolean).join(' · ');
    $('base').innerHTML = `<div class="l">${img(cfg.logo)}<div><b>${esc(cfg.title)}</b><span>${esc(sub)}</span></div></div>` +
      (cfg.sponsors.length ? `<div class="sp">${cfg.sponsors.map((s, i) => `<img src="${esc(s)}" class="${i === spIdx % cfg.sponsors.length ? 'on' : ''}">`).join('')}</div>` : '');
  }
  setInterval(() => {
    if (cfg.sponsors.length < 2) return;
    spIdx++;
    document.querySelectorAll('#base .sp img').forEach((im, i) => im.classList.toggle('on', i === spIdx % cfg.sponsors.length));
  }, 8000);

  function bannerHtml(b) {
    const pe = b.pid && ix.p[b.pid], t = pe ? pe.t : ix.t[b.tid];
    if (!t) return '';
    const name = pe ? pe.p.name : t.name;
    const photo = pe ? (pe.p.photo ? img(pe.p.photo) : (t.logo ? img(t.logo, 'big') : '')) : (t.logo ? img(t.logo, 'big') : '');
    const L = {
      airdrop: ['AIRDROP', '<em>LOOTED</em>'],
      sharp: [`${esc(b.v)} MTR`, '<em>SHARPSHOOTER</em>', 1],
      damage: [`<em>${esc(b.v)}</em>`, 'DAMAGE'],
      rampage: ['RAMPAGE', `ELIMS <em>${esc(b.v)}</em>`],
      domination: ['DOMINATION', `ELIMS <em>${esc(b.v)}</em>`],
      stealer: ['ELIM', '<em>STEALER</em>'],
      firstblood: ['FIRST', '<em>BLOOD</em>'],
      custom: [esc(b.l1), `<em>${esc(b.l2)}</em>`, (b.l2 || '').length > 9]
    }[b.type];
    if (!L) return '';
    return `<div class="bn"><div class="card"><div class="ids">${t.logo && pe ? img(t.logo, 'lg') : ''}${flag(t)}</div><div class="ph">${photo}</div>` +
      `<div class="tx"><b>${L[0]}</b><b class="${L[2] ? 's' : ''}">${L[1]}</b></div></div><div class="nm">${esc(name)}</div></div>`;
  }
  function nextPop() {
    if (popBusy || !popQ.length) return;
    const html = bannerHtml(popQ.shift());
    if (!html) return nextPop();
    popBusy = true;
    const pop = $('pop');
    pop.innerHTML = html; pop.classList.add('on');
    setTimeout(() => { pop.classList.remove('on'); setTimeout(() => { popBusy = false; nextPop(); }, 650); }, 6500);
  }
  function nextElim() {
    if (elimBusy || !elimQ.length) return;
    const b = elimQ.shift(), v = ix.t[b.tid], a = ix.t[b.by];
    if (!v) return nextElim();
    elimBusy = true;
    const el = $('telim');
    el.innerHTML = `<div class="te"><div class="sd">${a ? logo(a) + esc(a.tag) : ''}</div><div class="mid"><b>ELIMINATED</b><span>${a ? '▶▶▶▶' : (b.place ? '#' + esc(b.place) : '')}</span></div><div class="sd v">${logo(v)}${esc(v.tag)}</div></div>`;
    el.classList.remove('hide');
    setTimeout(() => { el.classList.add('hide'); setTimeout(() => { elimBusy = false; nextElim(); }, 600); }, 5500);
  }
  function takeBanners() {
    const first = seen === null;
    if (first) seen = {};
    live.banners.forEach(b => {
      if (seen[b.id]) return;
      seen[b.id] = 1;
      if (first && Date.now() - b.ts > 4000) return; // don't replay old banners after a reload
      if (live.show.scene) return; // nothing pops over a fullscreen scene
      (b.type === 'teamelim' ? elimQ : popQ).push(b);
    });
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
    if (z.id !== zoneId) {
      // start a local countdown on arrival, so a clock difference between PCs doesn't matter
      const fresh = Math.abs(Date.now() - z.at) < 5000 || zoneId !== null;
      zoneId = z.id; zoneEnd = fresh ? Date.now() + z.sec * 1000 : z.at + z.sec * 1000;
    }
  }
  let lastTick = -1;
  setInterval(() => {
    const el = $('zone'), left = Math.ceil((zoneEnd - Date.now()) / 1000);
    const on = zoneEnd && left > 0 && left <= (cfg.zoneShowAt || 10) && !live.show.scene;
    el.classList.toggle('hide', !on);
    if (on && left !== lastTick) {
      lastTick = left;
      el.innerHTML = `<div class="t"><span>CIRCLE</span><span>CLOSING IN</span></div><div class="c"><b class="tick">${left}</b></div>`;
    }
  }, 200);

  /* ---------- fullscreen scenes ---------- */
  function head(h1, h2) {
    return `<div class="brand">${img(cfg.logo)}<span>${esc(cfg.title)}</span></div><h1>${esc(h1)}</h1><h2>${esc(h2)}</h2>`;
  }
  function table(list, cols) {
    const n = list.length, two = n > 10, per = two ? Math.ceil(n / 2) : n;
    const th = Math.max(34, Math.min(72, Math.floor(700 / (per + 1))));
    const hd = `<div class="tr h"><span>RANK</span><span></span><span></span><span class="nm">TEAM</span>${cols.map(c => `<span>${c[0]}</span>`).join('')}</div>`;
    const row = (r, i) => `<div class="tr ${i < 3 ? 'top3' : ''}" style="animation-delay:${i * 40}ms"><span class="rk">#${i + 1}</span>${flag(r.t) || '<span></span>'}${r.t.logo ? img(r.t.logo, 'lg') : '<span></span>'}<span class="nm">${esc(two ? r.t.tag : r.t.name || r.t.tag)}</span>${cols.map(c => `<span class="${c[2] || ''}">${c[1](r)}</span>`).join('')}</div>`;
    const colHtml = part => `<div>${hd}${part.map(x => row(x.r, x.i)).join('')}</div>`;
    const items = list.map((r, i) => ({ r, i }));
    return `<div class="tb" style="--th:${th}px;grid-template-columns:${two ? '1fr 1fr' : '1fr'}">${colHtml(items.slice(0, per))}${two ? colHtml(items.slice(per)) : ''}</div>`;
  }
  function playerCard(pid, i, withTeam) {
    const e = ix.p[pid]; if (!e) return '';
    const tot = U.playerTotals(cfg, hist, live)[pid] || { k: 0, kn: 0, dmg: 0, surv: 0, n: 0 };
    return `<div class="pc" style="animation-delay:${i * 90}ms"><div class="ph">${e.p.photo ? img(e.p.photo) : `<div class="no">${i + 1}</div>`}</div><div class="nm">${esc(e.p.name)}</div>` +
      (withTeam ? `<div class="tm">${e.t.logo ? img(e.t.logo) : ''}${esc(e.t.tag)}</div>` : '') +
      `<dl><div>ELIMS<dd>${tot.k}</dd></div><div>DAMAGE<dd>${Math.round(tot.dmg)}</dd></div><div>KNOCKS<dd>${tot.kn}</dd></div><div>AVG. SURV.<dd>${tot.n ? U.mmss(tot.surv / tot.n) : '--:--'}</dd></div></dl></div>`;
  }
  function sceneHtml() {
    const s = live.show.scene, t = ix.t[live.show.sceneTeam];
    if (s === 'results') {
      const used = Object.keys(live.players).length || !hist.matches.length ? live : hist.matches[hist.matches.length - 1];
      const no = used === live ? live.matchNo : used.no, map = used === live ? live.map : used.map;
      return `<div class="sc">${head('MATCH RESULTS', `${cfg.stage} · MATCH ${no} · ${map || ''}`)}${table(U.matchRows(cfg, used), [['WWCD', r => r.wwcd ? '🍗' : '-'], ['PLACE PTS', r => r.pp], ['ELIMS', r => r.elims], ['TOTAL', r => r.total, 'tot']])}</div>`;
    }
    if (s === 'overall') {
      return `<div class="sc">${head('OVERALL RANKING', `${cfg.stage} · POST MATCH ${hist.matches.length}`)}${table(U.overall(cfg, hist), [['WWCD', r => r.wwcd], ['PLACE PTS', r => r.pp], ['ELIMS', r => r.elims], ['TOTAL', r => r.total, 'tot']])}</div>`;
    }
    if (s === 'team' && t) {
      return `<div class="sc">${head(t.name || t.tag, 'TEAM PERFORMANCE')}<div class="cards"><div class="side">${t.logo ? img(t.logo, 'lg') : ''}${flag(t)}</div>${t.players.map((p, i) => playerCard(p.id, i)).join('')}</div></div>`;
    }
    if (s === 'mvp') {
      const tot = U.playerTotals(cfg, hist, live);
      const top = Object.keys(tot).filter(id => ix.p[id]).sort((a, b) => (tot[b].k - tot[a].k) || (tot[b].dmg - tot[a].dmg) || (tot[b].kn - tot[a].kn)).slice(0, 5);
      return `<div class="sc">${head('TOP FRAGGERS', cfg.stage)}<div class="cards">${top.map((id, i) => playerCard(id, i, true)).join('')}</div></div>`;
    }
    if (s === 'champion' && t) {
      return `<div class="champ"><div class="k">CHAMPION OF THE MATCH</div><div class="bd">${logo(t)}</div><div class="n">${esc(t.name || t.tag)}</div><div class="s">WINNER WINNER CHICKEN DINNER · MATCH ${live.matchNo}</div></div>`;
    }
    return '';
  }
  function renderScene() {
    const el = $('scene'), s = live.show.scene;
    const key = s ? JSON.stringify([s, live.show.sceneTeam, live.matchNo, hist.matches.length, s === 'results' || s === 'team' || s === 'mvp' ? live._s : 0]) : '';
    if (key === sceneKey) return;
    const was = sceneKey; sceneKey = key;
    if (!s) { el.classList.remove('on'); return; }
    const html = sceneHtml();
    if (was && was.split(',')[0] === key.split(',')[0] && live.show.scene !== 'champion') { el.innerHTML = html; el.querySelectorAll('.tr,.pc').forEach(n => { n.style.animation = 'none'; }); }
    else el.innerHTML = html;
    el.classList.toggle('on', !!html);
  }

  function renderAll() {
    document.documentElement.style.setProperty('--acc', cfg.accent || '#ff6a1a');
    renderRank(); renderWwcd(); renderBase(); renderScene();
  }

  Store.on('config', d => { cfg = U.normConfig(d); ix = U.index(cfg); sceneKey = ''; renderAll(); });
  Store.on('history', d => { const s = JSON.stringify(d); if (s === lastHist) return; lastHist = s; hist = U.normHist(d); renderScene(); });
  Store.on('live', d => {
    const s = JSON.stringify(d);
    if (s === lastLive) return;
    lastLive = s; live = U.normLive(d);
    takeBanners(); takeZone(); renderAll();
  });

  (async () => {
    await Store.init();
    const [c, l, h] = await Promise.all([Store.load('config'), Store.load('live'), Store.load('history')]);
    cfg = U.normConfig(c); ix = U.index(cfg); hist = U.normHist(h);
    live = U.normLive(l); lastLive = JSON.stringify(l);
    takeBanners(); takeZone(); renderAll();
    Store.poll(7000);
  })();
})();
