/* Shared helpers and scoring logic for admin + overlay */
const U = {
  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  uid() { return Math.random().toString(36).slice(2, 9); },

  defConfig() {
    return {
      title: 'MY TOURNAMENT', stage: 'GRAND FINALS', logo: '', accent: '#d0142c', scene: 'dark', bg: '',
      sponsors: [], teams: [],
      points: { place: [10, 6, 5, 4, 3, 2, 1, 1], kill: 1 },
      auto: { teamElim: true, stealer: true, firstBlood: true, rampage: 4, domination: 7 },
      zoneShowAt: 10
    };
  },
  normConfig(c) {
    const d = U.defConfig();
    c = Object.assign(d, c || {});
    c.points = Object.assign({ place: [10, 6, 5, 4, 3, 2, 1, 1], kill: 1 }, c.points);
    c.auto = Object.assign(U.defConfig().auto, c.auto);
    c.teams = c.teams || []; c.sponsors = c.sponsors || [];
    c.teams.forEach(t => { t.players = t.players || []; });
    return c;
  },
  defLive(no) {
    return {
      matchNo: no || 1, map: 'ERANGEL', startedAt: null,
      players: {}, teams: {}, banners: [],
      show: { ranking: true, lower: true, wwcd: false, scene: null, sceneTeam: null },
      zone: null, _s: 0
    };
  },
  normLive(l) {
    const d = U.defLive(1);
    l = Object.assign(d, l || {});
    l.show = Object.assign(U.defLive(1).show, l.show);
    l.players = l.players || {}; l.teams = l.teams || {}; l.banners = l.banners || [];
    return l;
  },
  normHist(h) { h = h || {}; h.matches = h.matches || []; return h; },

  index(cfg) {
    const ix = { p: {}, t: {} };
    cfg.teams.forEach(t => { ix.t[t.id] = t; t.players.forEach(p => { ix.p[p.id] = { p, t }; }); });
    return ix;
  },
  flagUrl(code) {
    return /^[a-z]{2}$/i.test(code || '') ? `https://flagcdn.com/w80/${code.toLowerCase()}.png` : '';
  },
  P(live, pid) { return live.players[pid] || { k: 0, kn: 0, dmg: 0, st: 'a' }; },

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
    return cfg.teams.filter(t => t.players.length).map(t => U.teamLive(cfg, live, t)).sort((a, b) =>
      (a.out - b.out) || (a.out ? (a.place || 99) - (b.place || 99) : 0) || (b.elims - a.elims) || (b.alive - a.alive));
  },

  /* Points table of one match (live object or saved history record) */
  matchRows(cfg, rec) {
    const isHist = !rec.show;
    return cfg.teams.filter(t => t.players.length).map(t => {
      let place, elims;
      if (isHist) { const r = rec.teams[t.id] || {}; place = r.place || null; elims = r.elims || 0; }
      else { const tl = U.teamLive(cfg, rec, t); place = tl.place; elims = tl.elims; }
      const pp = U.placePts(cfg, place), kp = elims * (cfg.points.kill || 0);
      return { t, place, elims, pp, total: pp + kp, wwcd: place === 1 ? 1 : 0 };
    }).sort((a, b) => (b.total - a.total) || ((a.place || 99) - (b.place || 99)) || (b.elims - a.elims));
  },

  /* Overall standings across all finished matches */
  overall(cfg, hist) {
    const acc = {};
    cfg.teams.forEach(t => { acc[t.id] = { t, wwcd: 0, pp: 0, elims: 0, total: 0, last: 99 }; });
    hist.matches.forEach(m => U.matchRows(cfg, m).forEach(r => {
      const a = acc[r.t.id]; a.wwcd += r.wwcd; a.pp += r.pp; a.elims += r.elims; a.total += r.total; a.last = r.place || 99;
    }));
    return Object.values(acc).filter(a => a.t.players.length).sort((a, b) =>
      (b.total - a.total) || (b.wwcd - a.wwcd) || (b.pp - a.pp) || (b.elims - a.elims) || (a.last - b.last));
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
  mmss(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  }
};
