/* Shared helpers and scoring logic for admin + overlay + public table */
const U = {
  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  uid() { return Math.random().toString(36).slice(2, 9); },
  clone(o) { return JSON.parse(JSON.stringify(o)); },

  defConfig() {
    return {
      title: 'MY TOURNAMENT', stage: 'GRAND FINALS', logo: '', accent: '#d0142c', bg: '',
      sponsors: [], teams: [],
      stages: null, stageId: 'main',
      points: { place: [10, 6, 5, 4, 3, 2, 1, 1], kill: 1 },
      matchPoint: { on: false, target: 60 },
      brand: { pos: 'tr', size: 'm', name: true },
      auto: { teamElim: true, stealer: true, firstBlood: true, rampage: 4, domination: 7 },
      zoneShowAt: 10
    };
  },
  normConfig(c) {
    const d = U.defConfig();
    c = Object.assign(d, c || {});
    c.points = Object.assign({ place: [10, 6, 5, 4, 3, 2, 1, 1], kill: 1 }, c.points);
    c.auto = Object.assign(U.defConfig().auto, c.auto);
    c.matchPoint = Object.assign({ on: false, target: 60 }, c.matchPoint);
    c.brand = Object.assign({ pos: 'tr', size: 'm', name: true }, c.brand);
    c.teams = c.teams || []; c.sponsors = c.sponsors || [];
    c.music = Array.isArray(c.music) ? c.music : [];               // playlist: [{id, name, url}]
    c.chars = Array.isArray(c.chars) ? c.chars.slice(0, 4) : [];   // admin's own default characters (empty = built-in)
    U._chars = c.chars;
    c.teams.forEach(t => { t.players = t.players || []; });
    // stages (days / groups): each has its own matches and standings
    if (!Array.isArray(c.stages) || !c.stages.length) c.stages = [{ id: 'main', name: c.stage || 'GRAND FINALS', teams: null }];
    if (!c.stages.some(s => s.id === c.stageId)) c.stageId = c.stages[0].id;
    c.stage = U.stage(c).name;                     // display name of the current stage
    return c;
  },
  defLive(no) {
    return {
      matchNo: no || 1, map: 'ERANGEL', startedAt: null,
      players: {}, teams: {}, banners: [], log: [],
      show: { ranking: true, lower: true, wwcd: false, sound: false, scene: null, sceneTeam: null, sceneTeam2: null, mvp: null, info: null },
      zone: null, _s: 0
    };
  },
  normLive(l) {
    const d = U.defLive(1);
    l = Object.assign(d, l || {});
    l.show = Object.assign(U.defLive(1).show, l.show);
    l.players = l.players || {}; l.teams = l.teams || {}; l.banners = l.banners || []; l.log = l.log || [];
    l._s = l._s || 0;
    return l;
  },
  normHist(h) { h = h || {}; h.matches = h.matches || []; return h; },
  normMaps(m) { m = m || {}; m.list = m.list || []; m.list.forEach(x => { x.drops = x.drops || {}; }); return m; },

  index(cfg) {
    const ix = { p: {}, t: {} };
    cfg.teams.forEach(t => { ix.t[t.id] = t; t.players.forEach(p => { ix.p[p.id] = { p, t }; }); });
    return ix;
  },
  flagUrl(code) {
    return /^[a-z]{2}$/i.test(code || '') ? `img/flags/${code.toLowerCase()}.png` : '';   // bundled: works even where flagcdn.com is blocked
  },
  P(live, pid) { return live.players[pid] || { k: 0, kn: 0, dmg: 0, st: 'a' }; },

  /* ---------- stages ---------- */
  stage(cfg) { return cfg.stages.find(s => s.id === cfg.stageId) || cfg.stages[0]; },
  inStage(cfg, t) { const s = U.stage(cfg); return !s.teams || s.teams.includes(t.id); },
  /* Teams that take part in the current stage (and have players) */
  teams(cfg) { return cfg.teams.filter(t => t.players.length && U.inStage(cfg, t)); },
  /* Finished matches of the current stage, as a history-like object */
  stageHist(cfg, hist) { return { matches: hist.matches.filter(m => (m.sid || 'main') === cfg.stageId) }; },

  /* Live status of one team in the current match */
  teamLive(cfg, live, t) {
    const pl = t.players.map(p => Object.assign({ id: p.id, name: p.name, photo: p.photo }, U.P(live, p.id)));
    const elims = pl.reduce((s, p) => s + (p.k || 0), 0);
    const alive = pl.filter(p => p.st !== 'd').length;
    const place = (live.teams[t.id] || {}).place || null;
    return { t, pl, elims, alive, place, out: pl.length > 0 && alive === 0 };
  },
  placePts(cfg, place) { return place ? (cfg.points.place[place - 1] || 0) : 0; },

  /* In-game ranking: teams still playing first (by elims), eliminated teams below */
  liveRanking(cfg, live) {
    return U.teams(cfg).map(t => U.teamLive(cfg, live, t)).sort((a, b) =>
      (a.out - b.out) || (a.out ? (a.place || 99) - (b.place || 99) : 0) || (b.elims - a.elims) || (b.alive - a.alive));
  },

  /* Points table of one match (live object or saved history record) */
  matchRows(cfg, rec) {
    const isHist = !rec.show;
    return U.teams(cfg).map(t => {
      let place, elims;
      if (isHist) { const r = rec.teams[t.id] || {}; place = r.place || null; elims = r.elims || 0; }
      else { const tl = U.teamLive(cfg, rec, t); place = tl.place; elims = tl.elims; }
      const pp = U.placePts(cfg, place), kp = elims * (cfg.points.kill || 0);
      return { t, place, elims, pp, total: pp + kp, wwcd: place === 1 ? 1 : 0 };
    }).sort((a, b) => (b.total - a.total) || ((a.place || 99) - (b.place || 99)) || (b.elims - a.elims));
  },

  /* Overall standings across the given finished matches (pass U.stageHist for the current stage) */
  overall(cfg, hist) {
    const acc = {};
    U.teams(cfg).forEach(t => { acc[t.id] = { t, wwcd: 0, pp: 0, elims: 0, total: 0, last: 99, n: 0, places: 0 }; });
    hist.matches.forEach(m => U.matchRows(cfg, m).forEach(r => {
      const a = acc[r.t.id]; a.wwcd += r.wwcd; a.pp += r.pp; a.elims += r.elims; a.total += r.total; a.last = r.place || 99;
      if (r.place) { a.n++; a.places += r.place; }
    }));
    return Object.values(acc).sort((a, b) =>
      (b.total - a.total) || (b.wwcd - a.wwcd) || (b.pp - a.pp) || (b.elims - a.elims) || (a.last - b.last));
  },

  /* Match point rule: a team that already reached the target and then wins a match is the champion */
  matchPoint(cfg, hist) {
    const on = !!cfg.matchPoint.on, target = +cfg.matchPoint.target || 0;
    const totals = {}; let champ = null;
    if (on) hist.matches.forEach(m => {
      const rows = U.matchRows(cfg, m), win = rows.find(r => r.place === 1);
      if (!champ && win && (totals[win.t.id] || 0) >= target) champ = win.t.id;
      rows.forEach(r => { totals[r.t.id] = (totals[r.t.id] || 0) + r.total; });
    });
    const mp = {};
    if (on) Object.keys(totals).forEach(id => { if (totals[id] >= target) mp[id] = 1; });
    return { on, target, mp, champ };
  },

  /* Per-player totals: finished matches + (optionally) the current live match */
  playerTotals(cfg, hist, live) {
    const acc = {};
    const add = (pid, s, surv, counted) => {
      const a = acc[pid] || (acc[pid] = { k: 0, kn: 0, dmg: 0, surv: 0, n: 0 });
      a.k += s.k || 0; a.kn += s.kn || 0; a.dmg += +s.dmg || 0;
      if (counted && surv != null) { a.surv += surv; a.n++; }
    };
    hist.matches.forEach(m => Object.keys(m.players || {}).forEach(pid => add(pid, m.players[pid], m.players[pid].surv, true)));
    if (live) Object.keys(live.players).forEach(pid => add(pid, live.players[pid], 0, false));
    return acc;
  },
  /* Best player from a {pid: stats} map: elims, then damage, then knocks */
  bestPlayer(stats, ix) {
    return Object.keys(stats).filter(id => ix.p[id]).sort((a, b) =>
      ((stats[b].k || 0) - (stats[a].k || 0)) || ((+stats[b].dmg || 0) - (+stats[a].dmg || 0)) || ((stats[b].kn || 0) - (stats[a].kn || 0)))[0] || null;
  },
  /* Slim copy of the config for the public standings page (no player photos, no backgrounds) */
  publicConfig(cfg) {
    return {
      title: cfg.title, logo: cfg.logo, accent: cfg.accent, brand: cfg.brand, stages: cfg.stages, stageId: cfg.stageId,
      points: cfg.points, matchPoint: cfg.matchPoint,
      teams: cfg.teams.map(t => ({ id: t.id, tag: t.tag, name: t.name, flag: t.flag, logo: t.logo, players: t.players.map(p => ({ id: p.id, name: p.name })) }))
    };
  },
  /* Player picture: the uploaded photo, otherwise one of the four default characters
     (by the player's place in the team, so the four players of a team look different) */
  DEF_CHARS: ['img/chars/c1.webp', 'img/chars/c2.webp', 'img/chars/c3.webp', 'img/chars/c4.webp'],
  photo(t, p) {
    if (p && p.photo) return { src: p.photo, def: false };
    const i = Math.max(0, t && p ? t.players.findIndex(x => x.id === p.id) : 0);
    const k = i % U.DEF_CHARS.length;
    return { src: (U._chars && U._chars[k]) || U.DEF_CHARS[k], def: true };
  },
  PER_PAGE: 16,                                    // teams per page of a standings scene / picture
  pages(n) { return Math.max(1, Math.ceil(n / U.PER_PAGE)); },
  mmss(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  }
};
