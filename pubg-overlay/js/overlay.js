/* OBS browser source: renders everything from the shared state */
(() => {
  const { esc } = U;
  const $ = id => document.getElementById(id);
  const q = new URLSearchParams(location.search);
  let cfg = U.defConfig(), live = U.defLive(1), hist = U.normHist(), maps = U.normMaps(), ix = U.index(cfg);
  const H = () => U.stageHist(cfg, hist);          // finished matches of the current stage
  let lastLive = '', lastHist = '', seen = null, booted = false;
  const popQ = [], elimQ = [];
  let popBusy = false, elimBusy = false, zoneId = null, zoneEnd = 0, zoneLen = 0, sceneKey = '', infoId = null, infoEnd = 0;
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
  const flag = (t, cls) => { const u = U.flagUrl(t.flag); return u ? `<img class="${cls || 'fl'}" src="${u}" alt="" onerror="this.style.visibility='hidden'">` : ''; };
  const logo = (t, cls) => t.logo ? img(t.logo, cls || 'lg') : `<div class="nolg ${cls || ''}">${esc((t.tag || '?').slice(0, 4))}</div>`;
  /* Liquid band behind a bar: glossy body + drips that stretch and let a drop fall now and then.
     Positions come from the key, so the same bar always drips in the same places (no flicker on re-render). */
  function drips(key, n) {
    let h = 2166136261;
    for (const c of String(key)) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    const rnd = () => (h = (Math.imul(h, 1103515245) + 12345) >>> 0) / 4294967296;
    let s = '';
    for (let k = 0; k < n; k++) {
      const x = 7 + (86 / n) * (k + .15 + rnd() * .7);
      s += `<i style="left:${x.toFixed(1)}%;--w:${(13 + rnd() * 10).toFixed(0)}px;--h:${(18 + rnd() * 26).toFixed(0)}px;--d:${(2.4 + rnd() * 2.6).toFixed(1)}s;--o:${(-rnd() * 4).toFixed(1)}s"></i>`;
    }
    return `<span class="lb">${s}</span>`;
  }
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

  /* ---------- sound effects (only when the admin switched them on) ---------- */
  let ac = null;
  window.__sfx = [];
  function sfx(kind) {
    if (!live.show.sound) return;
    window.__sfx.push(kind);
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      const t = ac.currentTime + .02, out = ac.createGain(); out.gain.value = .55; out.connect(ac.destination);
      const tone = (f0, f1, at, dur, type, vol) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = type; o.frequency.setValueAtTime(f0, t + at); o.frequency.exponentialRampToValueAtTime(f1, t + at + dur);
        g.gain.setValueAtTime(.0001, t + at); g.gain.exponentialRampToValueAtTime(vol, t + at + .02); g.gain.exponentialRampToValueAtTime(.0001, t + at + dur);
        o.connect(g); g.connect(out); o.start(t + at); o.stop(t + at + dur + .05);
      };
      const noise = (at, dur, f0, f1, vol) => {
        const n = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        const src = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
        src.buffer = buf; f.type = 'bandpass'; f.Q.value = 1.2;
        f.frequency.setValueAtTime(f0, t + at); f.frequency.exponentialRampToValueAtTime(f1, t + at + dur);
        g.gain.setValueAtTime(.0001, t + at); g.gain.exponentialRampToValueAtTime(vol, t + at + dur * .3); g.gain.exponentialRampToValueAtTime(.0001, t + at + dur);
        src.connect(f); f.connect(g); g.connect(out); src.start(t + at);
      };
      if (kind === 'pop') { noise(0, .35, 400, 4000, .25); tone(523, 523, .12, .18, 'triangle', .3); tone(784, 784, .26, .32, 'triangle', .3); }
      else if (kind === 'elim') { tone(160, 45, 0, .6, 'sine', .7); noise(0, .25, 2000, 200, .3); tone(300, 150, .05, .35, 'sawtooth', .1); }
      else if (kind === 'champ') { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, i * .14, .5, 'triangle', .3)); tone(1047, 1047, .56, 1.1, 'triangle', .32); noise(0, .7, 500, 6000, .14); }
      else if (kind === 'scene') noise(0, .5, 300, 3000, .2);
      else if (kind === 'tick') tone(880, 880, 0, .09, 'square', .1);
    } catch (e) { /* no audio available */ }
  }

  /* ---------- ranking ---------- */
  function renderRank() {
    const el = $('rank');
    const list = U.liveRanking(cfg, live);
    el.classList.toggle('hide', !live.show.ranking || !list.length || !!live.show.scene);
    if (!list.length) return;
    if (!el.firstChild) el.innerHTML = '<div class="rk-lead lqb"></div><div class="rk-head"><span>#</span><span>TEAM</span><span>ALIVE</span><span>ELIMS</span></div><div class="rk-rows"></div><div class="rk-foot"><span><i class="a"></i>ALIVE</span><span><i class="k"></i>KNOCKED</span><span><i></i>ELIMINATED</span></div>';
    const lead = list[0], rest = list.slice(1), MP = U.matchPoint(cfg, H());
    setHtml(el.querySelector('.rk-lead'),
      drips('lead' + lead.t.id, 4) + `<div class="bdg">#1${MP.mp[lead.t.id] ? ' · MP' : ''}</div>${logo(lead.t)}<div class="inf"><div class="tg">${flag(lead.t)}<span>${esc(lead.t.tag)}</span></div>${pips(lead.pl)}</div><div class="el"><b>${lead.elims}</b><small>ELIMS</small></div>`);
    const rh = Math.max(18, Math.min(34, Math.floor((rest.length > 18 ? 600 : 690) / Math.max(1, rest.length))));   // many teams: stay clear of the bottom edge
    el.style.setProperty('--rh', rh + 'px'); el.classList.toggle('many', rest.length > 18);
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
      setHtml(d, `<span class="n">${i + 2}</span>${flag(r.t) || '<span></span>'}${r.t.logo ? img(r.t.logo, 'lg') : '<span></span>'}<span class="tg">${esc(r.t.tag)}${MP.mp[r.t.id] ? '<i class="mpt">MP</i>' : ''}</span>${pips(r.pl)}<span class="el">${r.elims}</span>`);
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
      return `<div class="wc"><div class="top">${logo(r.t)}<div class="mid"><b>${esc(r.t.tag)}</b>${pips(r.pl)}</div>${flag(r.t)}</div><div class="bot"><i class="fill" style="width:${pc.toFixed(1)}%"></i><span>WWCD</span><b>${pc.toFixed(1)}%</b></div></div>`;
    }).join(''));
  }

  /* ---------- lower third ---------- */
  let spIdx = 0;
  function renderBase() {
    $('lower').classList.toggle('hide', !live.show.lower || !!live.show.scene);
    const sub = [cfg.stage, 'MATCH ' + live.matchNo, live.map].filter(Boolean).join(' · ');
    const changed = setHtml($('base'), `<div class="lg lqb">${drips('base', 3)}${cfg.logo ? img(cfg.logo) : ''}</div><div class="l"><b>${esc(cfg.title)}</b><span>${esc(sub)}</span></div>` +
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
      `<div class="nm lqb">${drips('nm' + name, 5)}${pe && t.logo ? img(t.logo, 'tl') : ''}<span class="tt">${esc(pe ? t.tag : '')}</span><span class="nn">${esc(name)}</span>${flag(t)}</div></div>`;
  }
  function nextPop() {
    if (popBusy || !popQ.length) return;
    const b = popQ.shift();
    const html = Date.now() - b._in > 9000 ? '' : bannerHtml(b);   // too late to be relevant: skip
    if (!html) return nextPop();
    popBusy = true;
    const pop = $('pop');
    pop.innerHTML = html; pop.classList.add('on'); sfx('pop');
    setTimeout(() => { pop.classList.remove('on'); setTimeout(() => { popBusy = false; nextPop(); }, 650); }, popQ.length ? 4200 : 6000);
  }
  function nextElim() {
    if (elimBusy || !elimQ.length) return;
    const b = elimQ.shift(), v = ix.t[b.tid], a = ix.t[b.by];
    if (!v || Date.now() - b._in > 9000) return nextElim();
    elimBusy = true;
    const el = $('telim');
    el.innerHTML = `<div class="te ${a ? '' : 'solo'}">${a ? `<div class="sd">${logo(a)}<span>${esc(a.tag)}</span></div>` : ''}<div class="mid lqb">${drips('te' + v.id, 5)}<b>ELIMINATED</b><span>${a ? '<i></i><i></i><i></i><i></i>' : (b.place ? 'FINISHED #' + esc(b.place) : '')}</span></div><div class="sd v">${logo(v)}<span>${esc(v.tag)}</span></div></div>`;
    el.classList.remove('hide'); sfx('elim');
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
  /* Zone gauge: liquid inside the circle drains as the time runs out (built once, then only updated) */
  let lastTick = -1;
  const WAVE = 'M0 6 Q11.25 0 22.5 6 T45 6 T67.5 6 T90 6 T112.5 6 T135 6 T157.5 6 T180 6 V120 H0 Z';
  setInterval(() => {
    const el = $('zone'), left = Math.ceil((zoneEnd - Date.now()) / 1000);
    const showAt = Math.min(cfg.zoneShowAt || 10, zoneLen || 10);
    const on = zoneEnd && left > 0 && left <= showAt && !live.show.scene;
    el.classList.toggle('hide', !on);
    if (!on) { lastTick = -1; return; }
    if (!el.__built) {
      el.__built = true;
      el.innerHTML = `<div class="t"><span>CIRCLE</span><span>CLOSING IN</span></div><div class="c"><svg viewBox="0 0 90 90">
        <defs><clipPath id="zclip"><circle cx="45" cy="45" r="35"/></clipPath>
          <linearGradient id="zliq" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--acc-l)"/><stop offset=".5" style="stop-color:var(--acc)"/><stop offset="1" style="stop-color:var(--acc-dd)"/></linearGradient></defs>
        <circle cx="45" cy="45" r="40" class="ring"/>
        <g clip-path="url(#zclip)"><rect width="90" height="90" class="glass"/>
          <g class="lvl"><path class="w2" d="${WAVE}"/><path class="w1" d="${WAVE}"/></g></g>
        <ellipse cx="36" cy="24" rx="18" ry="8" class="shine"/></svg><b></b></div>`;
    }
    if (left !== lastTick) {
      lastTick = left; if (left <= 3) sfx('tick');
      el.querySelector('.lvl').style.transform = `translateY(${(8 + 74 * (1 - left / showAt)).toFixed(1)}px)`;
      const b = el.querySelector('.c b'); b.textContent = left; b.classList.remove('tick'); void b.offsetWidth; b.classList.add('tick');
      el.classList.toggle('low', left <= 3);
    }
  }, 200);

  /* ---------- fullscreen scenes ---------- */
  /* Backdrop: the artwork plate. "rank" has the table panel painted in, "clean" is only the liquid frame.
     With an own background picture the panels are drawn in CSS instead (positions cannot be known). */
  const plate = () => !cfg.bg;
  function backdrop(kind) {
    return `<div class="bg" style="background-image:url('${cfg.bg ? esc(cfg.bg) : 'img/bg-' + kind + '.webp'}')"></div>`;
  }
  /* Tournament logo + name: position, size and name visibility are chosen in the admin settings */
  function brandHtml(where) {
    const B = cfg.brand, name = B.name && cfg.title;
    if (B.pos === 'none' || (!cfg.logo && !name)) return '';
    if ((where === 'bottom') !== (B.pos === 'bottom')) return '';
    return `<div class="brand b-${esc(B.pos)} s-${esc(B.size)} ${cfg.logo ? '' : 'noimg'}">${cfg.logo ? img(cfg.logo) : ''}${name ? `<span>${esc(cfg.title)}</span>` : ''}</div>`;
  }
  function frame(h1, h2, body, cls, kind) {
    const corner = cfg.brand.pos === 'tr' || cfg.brand.pos === 'tl';
    const fit = plate() && corner ? 800 : 1240;                // a title next to a corner logo must stay clear of it
    const spons = cfg.sponsors.map(s => img(s)).join(''), bb = brandHtml('bottom');
    return `<div class="sc ${plate() ? 'art' : ''} ${plate() && kind === 'rank' ? 'plate' : ''} bp-${esc(cfg.brand.pos)} ${cls || ''}">${backdrop(kind || 'clean')}${brandHtml('top')}` +
      `<div class="hd"><h1 style="font-size:${Math.min(plate() ? 74 : 82, Math.floor(fit / (Math.max(1, String(h1).length) * .8)))}px">${esc(h1)}</h1><h2>${esc(h2)}</h2></div><div class="body">${body}</div>` +
      (spons || bb ? `<div class="spons">${bb}${spons}</div>` : '') + '</div>';
  }
  /* Left side: the leading team (player photos, or the logo when there are none) */
  function hero(t, label) {
    const ph = t.players.filter(p => p.photo);
    const mid = Math.floor((ph.length - 1) / 2);
    return `<div class="hero"><div class="ppl">${ph.length ? ph.map((p, i) => `<img src="${esc(p.photo)}" style="z-index:${10 - Math.abs(i - mid)};height:${100 - Math.abs(i - mid) * 9}%">`).join('') : logo(t)}</div>` +
      `${plate() ? '<img class="rib" src="img/ribbon.png" alt="">' : ''}<div class="hb lq"><b>${esc(label)}</b>${flag(t)}<span>${esc(t.name || t.tag)}</span></div></div>`;
  }
  function table(list, cols, moves, mp, off) {
    off = off || 0;
    const n = list.length, two = !plate() && n > 10, per = two ? Math.ceil(n / 2) : n;
    const extra = mp && mp.on ? 2 : 1;
    const th = plate() ? Math.max(18, Math.min(62, Math.floor(574 / (n + extra)))) : Math.max(30, Math.min(62, Math.floor(560 / (per + extra))));
    const note = mp && mp.on ? `<div class="tr note"><span>MATCH POINT TARGET ${esc(mp.target)}</span></div>` : '';
    const mark = r => !mp ? '' : mp.champ === r.t.id ? 'champ' : mp.mp[r.t.id] ? 'mp' : '';
    const mv = r => !moves ? '' : moves[r.t.id] > 0 ? '<i class="up"></i>' : moves[r.t.id] < 0 ? '<i class="dn"></i>' : '<i class="eq"></i>';
    const hd = `<div class="tr h"><span></span><span>RANK</span><span></span><span></span><span class="nm">TEAMS</span>${cols.map(c => `<span>${c[0]}</span>`).join('')}</div>`;
    const row = (r, i) => `<div class="tr ${i === 0 && !off ? 'top1 lqb' : ''} ${mark(r)}" style="animation-delay:${i * 35}ms">${i === 0 && !off ? drips('row' + r.t.id, 6) : ''}<span class="mv">${mv(r)}</span><span class="rk">#${i + 1 + off}</span>${flag(r.t) || '<span></span>'}${r.t.logo ? img(r.t.logo, 'lg') : '<span></span>'}<span class="nm">${esc(r.t.tag || r.t.name)}</span>${cols.map(c => `<span class="${c[2] || ''}">${c[1](r)}</span>`).join('')}</div>`;
    const colHtml = part => `<div>${hd}${note}${part.map(x => row(x.r, x.i)).join('')}</div>`;
    const items = list.map((r, i) => ({ r, i }));
    return `<div class="tb lq ${two ? 'two' : ''}" style="--th:${th}px">${colHtml(items.slice(0, per))}${two ? colHtml(items.slice(per)) : ''}</div>`;
  }
  /* More than 16 teams: the admin switches pages (16 per page); the hero shows the best team of the page */
  function ranking(h1, h2, list, cols, moves, mp) {
    if (!list.length) return frame(h1, h2, '');
    const pages = U.pages(list.length), pg = Math.min(pages - 1, Math.max(0, +live.show.page || 0)), off = pg * U.PER_PAGE;
    const part = list.slice(off, off + U.PER_PAGE);
    const h2p = pages > 1 ? h2 + ' ▪ ' + (pg + 1) + '/' + pages : h2;
    return frame(h1, h2p, hero(part[0].t, '#' + (off + 1)) + table(part, cols, moves, pg ? null : mp, off), !plate() && part.length > 10 ? 'wide' : '', 'rank');
  }
  function playerCard(pid, i, withTeam) {
    const e = ix.p[pid]; if (!e) return '';
    const tot = U.playerTotals(cfg, H(), live)[pid] || { k: 0, kn: 0, dmg: 0, surv: 0, n: 0 };
    return `<div class="pc lq" style="animation-delay:${i * 90}ms"><div class="ph">${e.p.photo ? img(e.p.photo) : logo(e.t, 'wm')}${withTeam ? `<div class="rkn">#${i + 1}</div>` : ''}</div><div class="nm lqb">${drips('pc' + pid, 4)}${esc(e.p.name)}</div>` +
      (withTeam ? `<div class="tm">${e.t.logo ? img(e.t.logo) : ''}${esc(e.t.tag)}</div>` : '') +
      `<dl><div>ELIMS<dd>${tot.k}</dd></div><div>DAMAGE<dd>${Math.round(tot.dmg)}</dd></div><div>KNOCKS<dd>${tot.kn}</dd></div><div>AVG. SURV.<dd>${tot.n ? U.mmss(tot.surv / tot.n) : '--:--'}</dd></div></dl></div>`;
  }
  function sceneHtml() {
    const s = live.show.scene, t = ix.t[live.show.sceneTeam];
    const wwcd = r => r.wwcd ? '<i class="ck"></i>' : '0';
    const sub = a => a.filter(Boolean).join(' ▪ ');
    if (s === 'results') {
      const hm = H().matches;
      const used = Object.keys(live.players).length || !hm.length ? live : hm[hm.length - 1];
      const no = used === live ? live.matchNo : used.no, map = used === live ? live.map : used.map;
      return ranking('MATCH RESULTS', sub([cfg.stage, 'MATCH ' + no, map]), U.matchRows(cfg, used), [['WWCD', wwcd], ['PLACE PTS.', r => r.pp], ['ELIMS.', r => r.elims], ['TOTAL PTS.', r => r.total, 'tot']]);
    }
    if (s === 'overall') {
      const sh = H(), now = U.overall(cfg, sh), moves = {};
      if (sh.matches.length > 1) {
        const before = U.overall(cfg, { matches: sh.matches.slice(0, -1) });
        now.forEach((r, i) => { moves[r.t.id] = before.findIndex(x => x.t.id === r.t.id) - i; });
      }
      return ranking('OVERALL RANKING', sub([cfg.stage, 'POST MATCH ' + sh.matches.length]), now, [['WWCD', r => r.wwcd], ['PLACE PTS.', r => r.pp], ['ELIMS.', r => r.elims], ['TOTAL PTS.', r => r.total, 'tot']], moves, U.matchPoint(cfg, sh));
    }
    if (s === 'team' && t) {
      return frame(t.name || t.tag, 'TEAM PERFORMANCE', `<div class="cards"><div class="side">${logo(t)}${flag(t)}</div>${t.players.map((p, i) => playerCard(p.id, i)).join('')}</div>`);
    }
    if (s === 'mvp') {
      const tot = U.playerTotals(cfg, H(), live);
      const top = Object.keys(tot).filter(id => ix.p[id]).sort((a, b) => (tot[b].k - tot[a].k) || (tot[b].dmg - tot[a].dmg) || (tot[b].kn - tot[a].kn)).slice(0, 5);
      return frame('TOP FRAGGERS', cfg.stage, `<div class="cards">${top.map((id, i) => playerCard(id, i, true)).join('')}</div>`);
    }
    if (s === 'champion' && t) {
      return frame('CHAMPION OF THE MATCH', sub([cfg.stage, 'MATCH ' + live.matchNo, live.map]), `<div class="champ"><div class="bd">${logo(t)}</div><div class="hb lq"><b>WWCD</b>${flag(t)}<span>${esc(t.name || t.tag)}</span></div></div>`, 'ch');
    }
    if (s === 'info' && live.show.info) {
      const inf = live.show.info;
      return frame(inf.h1, inf.h2, `<div class="info">${inf.cd ? '<div class="cd lq"><b id="cd">--:--</b></div>' : (cfg.logo ? img(cfg.logo, 'biglogo') : '')}<div class="ttl">${esc(cfg.title)}</div></div>`);
    }
    if (s === 'map') {
      const want = String(live.map || '').toUpperCase();
      const m = maps.list.find(x => x.name === want && x.img) || maps.list.find(x => x.img);
      if (!m) return frame('DROP LOCATIONS', sub([cfg.stage, 'MATCH ' + live.matchNo, live.map]), '<div class="info"><div class="ttl">NO MAP IMAGE</div></div>');
      const ts = U.teams(cfg).filter(t => m.drops[t.id]);
      return frame('DROP LOCATIONS', sub([cfg.stage, 'MATCH ' + live.matchNo, m.name]), `<div class="mapsc"><div class="mbox lq"><div class="mimg"><img src="${esc(m.img)}">` +
        ts.map((t, i) => `<div class="pin" style="left:${m.drops[t.id][0] * 100}%;top:${m.drops[t.id][1] * 100}%;animation-delay:${i * 60}ms">${logo(t)}<span>${esc(t.tag)}</span></div>`).join('') +
        `</div></div><div class="mleg lq">${ts.map(t => `<div>${logo(t)}<span>${esc(t.tag)}</span></div>`).join('')}</div></div>`);
    }
    if (s === 'vs') {
      const a = t, b = ix.t[live.show.sceneTeam2];
      if (!a || !b) return '';
      const ov = U.overall(cfg, H()), ra = ov.find(r => r.t.id === a.id), rb = ov.find(r => r.t.id === b.id);
      if (!ra || !rb) return '';
      const la = U.teamLive(cfg, live, a).elims, lb = U.teamLive(cfg, live, b).elims;
      const avg = r => r.n ? (r.places / r.n).toFixed(1) : '–';
      const st = [['OVERALL RANK', ov.indexOf(ra) + 1, ov.indexOf(rb) + 1, -1, '#'], ['TOTAL PTS.', ra.total, rb.total, 1], ['ELIMS.', ra.elims, rb.elims, 1], ['PLACE PTS.', ra.pp, rb.pp, 1], ['WWCD', ra.wwcd, rb.wwcd, 1], ['AVG. PLACE', avg(ra), avg(rb), -1]];
      if (la || lb) st.push(['THIS MATCH ELIMS', la, lb, 1]);
      const side = x => `<div class="vt">${logo(x)}<b>${esc(x.name || x.tag)}</b>${flag(x)}</div>`;
      const better = (x, y, dir) => isNaN(+x) || isNaN(+y) || +x === +y ? '' : ((+x - +y) * dir > 0 ? 'win' : '');
      return frame('HEAD TO HEAD', sub([cfg.stage, 'POST MATCH ' + H().matches.length]), `<div class="vs">${side(a)}<div class="vm lq">${st.map(r => `<div class="vr"><b class="${better(r[1], r[2], r[3])}">${r[4] || ''}${r[1]}</b><span>${r[0]}</span><b class="${better(r[2], r[1], r[3])}">${r[4] || ''}${r[2]}</b></div>`).join('')}</div>${side(b)}</div>`);
    }
    if (s === 'mvp1' && live.show.mvp) {
      const sc = live.show.mvp.scope, hm = H().matches;
      const matchStats = Object.keys(live.players).length || !hm.length ? live.players : hm[hm.length - 1].players;
      const all = U.playerTotals(cfg, H(), live);
      const stats = sc === 'match' ? matchStats : all;
      const pid = sc === 'pick' ? live.show.mvp.pid : U.bestPlayer(stats, ix);
      const e = pid && ix.p[pid]; if (!e) return frame(sc === 'match' ? 'MATCH MVP' : 'TOURNAMENT MVP', cfg.stage, '');
      const v = stats[pid] || { k: 0, kn: 0, dmg: 0 };
      const tile = (n, l) => `<div class="lq"><b>${n}</b><span>${l}</span></div>`;
      return frame(sc === 'match' ? 'MATCH MVP' : sc === 'all' ? 'TOURNAMENT MVP' : 'PLAYER SPOTLIGHT', sub([cfg.stage, sc === 'match' ? 'MATCH ' + (matchStats === live.players ? live.matchNo : hm[hm.length - 1].no) : '']),
        `<div class="mv1"><div class="ph lq">${e.p.photo ? img(e.p.photo) : logo(e.t, 'wm')}</div><div class="inf"><div class="nm">${esc(e.p.name)}</div><div class="tm">${e.t.logo ? img(e.t.logo) : ''}<span>${esc(e.t.name || e.t.tag)}</span>${flag(e.t)}</div>` +
        `<div class="sts">${tile(v.k || 0, 'ELIMS')}${tile(Math.round(+v.dmg || 0), 'DAMAGE')}${tile(v.kn || 0, 'KNOCKS')}${sc !== 'match' && v.n ? tile(U.mmss(v.surv / v.n), 'AVG. SURV.') : ''}</div></div></div>`);
    }
    return '';
  }
  /* Countdown of the break scenes: started locally when it arrives (clock differences don't matter) */
  function takeInfo() {
    const cd = live.show.scene === 'info' && live.show.info && live.show.info.cd;
    if (!cd) { infoId = null; infoEnd = 0; return; }
    if (cd.id === infoId) return;
    infoId = cd.id; infoEnd = booted ? Date.now() + cd.sec * 1000 : cd.at + cd.sec * 1000;
  }
  setInterval(() => { const el = $('cd'); if (el && infoEnd) el.textContent = U.mmss(Math.max(0, (infoEnd - Date.now()) / 1000)); }, 250);
  function renderScene() {
    const el = $('scene'), s = live.show.scene;
    if (!s) { sceneKey = ''; el.classList.remove('on'); return; }
    const html = sceneHtml();
    const key = [s, live.show.sceneTeam, live.show.sceneTeam2, (live.show.mvp || {}).scope, (live.show.info || {}).kind, live.show.page || 0].join('|');
    const same = sceneKey === key;                              // same scene, only numbers changed
    sceneKey = key;
    if (!same && html && booted) sfx(s === 'champion' ? 'champ' : 'scene');
    if (setHtml(el, html) && same) el.querySelectorAll('.tr,.pc,.champ *,.pin,.hb').forEach(n => { n.style.animation = 'none'; });
    el.classList.toggle('on', !!html);
  }

  function renderAll() { renderRank(); renderWwcd(); renderBase(); renderScene(); }

  Store.on('config', d => { cfg = U.normConfig(d); ix = U.index(cfg); applyTheme(); renderAll(); });
  Store.on('history', d => { const s = JSON.stringify(d); if (s === lastHist) return; lastHist = s; hist = U.normHist(d); renderAll(); });
  Store.on('maps', d => { maps = U.normMaps(d); renderScene(); });
  Store.on('live', d => {
    const s = JSON.stringify(d);
    if (s === lastLive) return;
    if ((d._s || 0) < (live._s || 0)) return;                   // an older version arriving late
    lastLive = s; live = U.normLive(d);
    takeBanners(); takeZone(); takeInfo(); renderAll();
  });

  (async () => {
    applyTheme();
    await Store.init();
    const [c, l, h, m] = await Promise.all([Store.load('config'), Store.load('live'), Store.load('history'), Store.load('maps')]);
    maps = U.normMaps(m);
    cfg = U.normConfig(c); ix = U.index(cfg); hist = U.normHist(h); lastHist = JSON.stringify(h);
    live = U.normLive(l); lastLive = JSON.stringify(l);
    applyTheme(); takeBanners(); takeZone(); takeInfo(); renderAll();
    booted = true;
    Store.poll(7000);
  })();
})();
