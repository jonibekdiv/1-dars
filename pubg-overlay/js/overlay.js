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
    let hex = (/^#?([0-9a-f]{6})$/i.exec(cfg.accent || '') || [0, 'd0142c'])[1].toLowerCase();
    if (hex === 'ff6a1a') hex = 'd0142c';                     // the old default colour
    const n = parseInt(hex, 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const mix = k => `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(b * k)})`;
    const lite = k => `rgb(${Math.round(r + (255 - r) * k)},${Math.round(g + (255 - g) * k)},${Math.round(b + (255 - b) * k)})`;
    const st = document.documentElement.style;
    st.setProperty('--acc', mix(1)); st.setProperty('--acc-l', lite(.28));
    st.setProperty('--acc-d', mix(.62)); st.setProperty('--acc-dd', mix(.3)); st.setProperty('--acc-k', mix(.16));
    st.setProperty('--acc-a', `rgba(${r},${g},${b},.3)`); st.setProperty('--acc-a2', `rgba(${r},${g},${b},.14)`);
    st.setProperty('--l1', lite(.28)); st.setProperty('--l2', mix(1)); st.setProperty('--l3', mix(.5));
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
  /* Liquid backdrop drawn in SVG (the "liq" filter in overlay.html makes the edges organic) */
  function backdrop() {
    if (cfg.bg) return `<div class="bg" style="background-image:url('${esc(cfg.bg)}')"></div>`;
    const light = cfg.scene === 'light';
    return `<svg class="bg" viewBox="0 0 1920 1080" preserveAspectRatio="none"><defs>
      <linearGradient id="gr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--l1)"/><stop offset=".45" style="stop-color:var(--l2)"/><stop offset=".8" style="stop-color:var(--l3)"/><stop offset="1" style="stop-color:var(--l2)"/></linearGradient>
      <linearGradient id="gw" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#c9ccd3"/></linearGradient>
      <linearGradient id="gk" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3a3a42"/><stop offset=".5" stop-color="#0c0c0f"/><stop offset="1" stop-color="#2a2a30"/></linearGradient></defs>
      <rect width="1920" height="1080" fill="${light ? '#f3f3f5' : '#1b1b20'}"/>
      <g filter="url(#liq)">
        <path fill="url(#gr)" d="M-40-40H700C640 40 520 20 440 110 360 200 250 150 170 250 100 340 40 320-40 420Z"/>
        <path fill="url(#gr)" d="M1960-40H1160C1250 30 1320 160 1450 140 1570 120 1610 40 1710 100 1800 150 1870 280 1960 290Z"/>
        <path fill="url(#gw)" d="M1960-40H1700C1750 70 1800 190 1960 230Z"/>
        <path fill="url(#gr)" d="M1960 340C1850 430 1900 570 1830 690 1770 790 1850 900 1960 960Z"/>
        <path fill="url(#gr)" d="M1960 1120H1120C1240 1010 1380 1070 1490 980 1600 890 1710 960 1810 860 1870 800 1920 790 1960 780Z"/>
        <path fill="url(#gw)" d="M1960 1120H1740C1790 1040 1860 1010 1960 980Z"/>
        <path fill="url(#${light ? 'gr' : 'gk'})" d="M-40 1120H620C520 1020 400 1060 310 970 220 880 110 900-40 780Z"/>
        <path fill="url(#gr)" d="M-40 1120H330C270 1060 190 1070 120 1010 60 960 10 960-40 930Z"/>
        <path fill="url(#gw)" d="M-40 1120H130C100 1080 50 1060-40 1050Z"/>
        <path fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="10" stroke-linecap="round" d="M60 60C200 40 330 60 420 20M1500 90C1560 70 1620 40 1680 60M1560 1010C1650 960 1740 990 1820 910M70 980C150 1000 230 1040 300 1040"/>
        <circle cx="560" cy="170" r="16" fill="url(#gr)"/><circle cx="610" cy="120" r="8" fill="url(#gr)"/><circle cx="1090" cy="70" r="12" fill="url(#gr)"/>
        <circle cx="1040" cy="1020" r="14" fill="url(#gr)"/><circle cx="700" cy="1040" r="9" fill="url(#gr)"/><circle cx="1850" cy="620" r="10" fill="url(#gw)"/>
      </g></svg>`;
  }
  function frame(h1, h2, body, cls) {
    return `<div class="sc ${cfg.scene === 'light' ? 'light' : ''} ${cls || ''}">${backdrop()}<div class="brand">${img(cfg.logo)}<span>${esc(cfg.title)}</span></div>` +
      `<div class="hd"><h1 style="font-size:${Math.min(82, Math.floor(1240 / (Math.max(1, String(h1).length) * .8)))}px">${esc(h1)}</h1><h2>${esc(h2)}</h2></div><div class="body">${body}</div>` +
      (cfg.sponsors.length ? `<div class="spons">${cfg.sponsors.map(s => img(s)).join('')}</div>` : '') + '</div>';
  }
  /* Left side: the leading team (player photos, or the logo when there are none) */
  function hero(t, label) {
    const ph = t.players.filter(p => p.photo);
    const mid = Math.floor((ph.length - 1) / 2);
    return `<div class="hero"><div class="ppl">${ph.length ? ph.map((p, i) => `<img src="${esc(p.photo)}" style="z-index:${10 - Math.abs(i - mid)};height:${100 - Math.abs(i - mid) * 9}%">`).join('') : logo(t)}</div>` +
      `<div class="hb lq"><b>${esc(label)}</b>${flag(t)}<span>${esc(t.name || t.tag)}</span></div></div>`;
  }
  function table(list, cols, moves) {
    const n = list.length, two = n > 10, per = two ? Math.ceil(n / 2) : n;
    const th = Math.max(30, Math.min(62, Math.floor(560 / (per + 1))));
    const mv = r => !moves ? '' : moves[r.t.id] > 0 ? '<i class="up"></i>' : moves[r.t.id] < 0 ? '<i class="dn"></i>' : '<i class="eq"></i>';
    const hd = `<div class="tr h"><span></span><span>RANK</span><span></span><span></span><span class="nm">TEAMS</span>${cols.map(c => `<span>${c[0]}</span>`).join('')}</div>`;
    const row = (r, i) => `<div class="tr ${i === 0 ? 'top1' : ''}" style="animation-delay:${i * 35}ms"><span class="mv">${mv(r)}</span><span class="rk">#${i + 1}</span>${flag(r.t) || '<span></span>'}${r.t.logo ? img(r.t.logo, 'lg') : '<span></span>'}<span class="nm">${esc(r.t.tag || r.t.name)}</span>${cols.map(c => `<span class="${c[2] || ''}">${c[1](r)}</span>`).join('')}</div>`;
    const colHtml = part => `<div>${hd}${part.map(x => row(x.r, x.i)).join('')}</div>`;
    const items = list.map((r, i) => ({ r, i }));
    return `<div class="tb lq ${two ? 'two' : ''}" style="--th:${th}px">${colHtml(items.slice(0, per))}${two ? colHtml(items.slice(per)) : ''}</div>`;
  }
  function ranking(h1, h2, list, cols, moves) {
    if (!list.length) return frame(h1, h2, '');
    return frame(h1, h2, hero(list[0].t, '#1') + table(list, cols, moves), list.length > 10 ? 'wide' : '');
  }
  function playerCard(pid, i, withTeam) {
    const e = ix.p[pid]; if (!e) return '';
    const tot = U.playerTotals(cfg, hist, live)[pid] || { k: 0, kn: 0, dmg: 0, surv: 0, n: 0 };
    return `<div class="pc lq" style="animation-delay:${i * 90}ms"><div class="ph">${e.p.photo ? img(e.p.photo) : logo(e.t, 'wm')}${withTeam ? `<div class="rkn">#${i + 1}</div>` : ''}</div><div class="nm">${esc(e.p.name)}</div>` +
      (withTeam ? `<div class="tm">${e.t.logo ? img(e.t.logo) : ''}${esc(e.t.tag)}</div>` : '') +
      `<dl><div>ELIMS<dd>${tot.k}</dd></div><div>DAMAGE<dd>${Math.round(tot.dmg)}</dd></div><div>KNOCKS<dd>${tot.kn}</dd></div><div>AVG. SURV.<dd>${tot.n ? U.mmss(tot.surv / tot.n) : '--:--'}</dd></div></dl></div>`;
  }
  function sceneHtml() {
    const s = live.show.scene, t = ix.t[live.show.sceneTeam];
    const wwcd = r => r.wwcd ? '<i class="ck"></i>' : '0';
    const sub = a => a.filter(Boolean).join(' ▪ ');
    if (s === 'results') {
      const used = Object.keys(live.players).length || !hist.matches.length ? live : hist.matches[hist.matches.length - 1];
      const no = used === live ? live.matchNo : used.no, map = used === live ? live.map : used.map;
      return ranking('MATCH RESULTS', sub([cfg.stage, 'MATCH ' + no, map]), U.matchRows(cfg, used), [['WWCD', wwcd], ['PLACE PTS.', r => r.pp], ['ELIMS.', r => r.elims], ['TOTAL PTS.', r => r.total, 'tot']]);
    }
    if (s === 'overall') {
      const now = U.overall(cfg, hist), moves = {};
      if (hist.matches.length > 1) {
        const before = U.overall(cfg, { matches: hist.matches.slice(0, -1) });
        now.forEach((r, i) => { moves[r.t.id] = before.findIndex(x => x.t.id === r.t.id) - i; });
      }
      return ranking('OVERALL RANKING', sub([cfg.stage, 'POST MATCH ' + hist.matches.length]), now, [['WWCD', r => r.wwcd], ['PLACE PTS.', r => r.pp], ['ELIMS.', r => r.elims], ['TOTAL PTS.', r => r.total, 'tot']], moves);
    }
    if (s === 'team' && t) {
      return frame(t.name || t.tag, 'TEAM PERFORMANCE', `<div class="cards"><div class="side">${logo(t)}${flag(t)}</div>${t.players.map((p, i) => playerCard(p.id, i)).join('')}</div>`);
    }
    if (s === 'mvp') {
      const tot = U.playerTotals(cfg, hist, live);
      const top = Object.keys(tot).filter(id => ix.p[id]).sort((a, b) => (tot[b].k - tot[a].k) || (tot[b].dmg - tot[a].dmg) || (tot[b].kn - tot[a].kn)).slice(0, 5);
      return frame('TOP FRAGGERS', cfg.stage, `<div class="cards">${top.map((id, i) => playerCard(id, i, true)).join('')}</div>`);
    }
    if (s === 'champion' && t) {
      return frame('CHAMPION OF THE MATCH', sub([cfg.stage, 'MATCH ' + live.matchNo, live.map]), `<div class="champ"><div class="bd">${logo(t)}</div><div class="hb lq"><b>WWCD</b>${flag(t)}<span>${esc(t.name || t.tag)}</span></div></div>`, 'ch');
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
