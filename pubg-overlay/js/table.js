/* Public standings page for viewers: read-only, refreshes itself every few seconds */
(() => {
  const { esc } = U;
  const $ = id => document.getElementById(id);
  let cfg = null, live = U.defLive(1), hist = U.normHist(), tab = 'overall', last = '', at = 0;

  const flag = t => { const u = U.flagUrl(t.flag); return u ? `<img class="fl" src="${u}" alt="">` : ''; };
  const logo = t => t.logo ? `<img class="lg" src="${esc(t.logo)}" alt="">` : '<i class="lg"></i>';
  const team = (t, extra) => `<td class="l"><div class="tm">${logo(t)}${flag(t)}<b>${esc(t.tag || t.name)}</b><span>${esc(t.name || '')}</span>${extra || ''}</div></td>`;
  const pips = pl => `<span class="pips">${pl.map(p => `<i class="${p.st === 'd' ? '' : p.st === 'k' ? 'k' : 'a'}"></i>`).join('')}</span>`;

  function overall() {
    const sh = U.stageHist(cfg, hist), rows = U.overall(cfg, sh), mp = U.matchPoint(cfg, sh);
    const mark = r => mp.champ === r.t.id ? '<em class="ch">CHEMPION</em>' : mp.mp[r.t.id] ? '<em>MATCH POINT</em>' : '';
    return `<h2>${esc(cfg.stage)} · ${sh.matches.length} match${mp.on ? ` · Match point: ${mp.target}` : ''}</h2>
      <table><tr><th>#</th><th class="l">Jamoa</th><th>WWCD</th><th>O'rin</th><th>Kill</th><th>Jami</th></tr>
      ${rows.map((r, i) => `<tr class="${i < 3 ? 'top' : ''}"><td class="n">${i + 1}</td>${team(r.t, mark(r))}<td>${r.wwcd}</td><td>${r.pp}</td><td>${r.elims}</td><td class="t">${r.total}</td></tr>`).join('')}</table>`;
  }
  function liveTab() {
    const rows = U.liveRanking(cfg, live), alive = rows.reduce((n, r) => n + r.alive, 0);
    if (!Object.keys(live.players).length) return `<h2>Match ${live.matchNo} · ${esc(live.map)}</h2><p class="hint">Match hali boshlanmagan.</p>`;
    return `<h2>Match ${live.matchNo} · ${esc(live.map)} · tirik: ${alive} o'yinchi, ${rows.filter(r => !r.out).length} jamoa</h2>
      <table><tr><th>#</th><th class="l">Jamoa</th><th>Holat</th><th>Kill</th></tr>
      ${rows.map((r, i) => `<tr class="${r.out ? 'out' : ''}"><td class="n">${r.out && r.place ? r.place : i + 1}</td>${team(r.t)}<td>${pips(r.pl)}</td><td class="t">${r.elims}</td></tr>`).join('')}</table>
      <p class="hint"><span class="pips"><i class="a"></i></span> tirik · <span class="pips"><i class="k"></i></span> nok · <span class="pips"><i></i></span> o'lgan</p>`;
  }
  function matches() {
    const ms = U.stageHist(cfg, hist).matches.slice().reverse();
    if (!ms.length) return '<p class="hint">Hali yakunlangan match yo\'q.</p>';
    return ms.map((m, k) => `<details ${k === 0 ? 'open' : ''}><summary>Match ${m.no} · ${esc(m.map || '')}</summary>
      <table><tr><th>#</th><th class="l">Jamoa</th><th>O'rin</th><th>Kill</th><th>Jami</th></tr>
      ${U.matchRows(cfg, m).map((r, i) => `<tr class="${r.place === 1 ? 'top' : ''}"><td class="n">${i + 1}</td>${team(r.t)}<td>${r.place || '-'}</td><td>${r.elims}</td><td class="t">${r.total}</td></tr>`).join('')}</table></details>`).join('');
  }
  function render() {
    if (!cfg) return;
    document.documentElement.style.setProperty('--acc', cfg.accent && cfg.accent !== '#ff6a1a' ? cfg.accent : '#d0142c');
    const html = tab === 'overall' ? overall() : tab === 'live' ? liveTab() : matches();
    const key = tab + html + cfg.title;
    if (key !== last) {
      last = key;
      const open = [...document.querySelectorAll('#main details')].map(d => d.open);
      $('brand').innerHTML = `${cfg.logo ? `<img src="${esc(cfg.logo)}" alt="">` : ''}<div><b>${esc(cfg.title)}</b><span>${esc(cfg.stage)}</span></div>`;
      $('main').innerHTML = html;
      if (tab === 'matches' && open.length) document.querySelectorAll('#main details').forEach((d, i) => { if (open[i] !== undefined) d.open = open[i]; });
      document.title = cfg.title + ' — jonli jadval';
    }
    $('foot').textContent = at ? 'Yangilandi: ' + new Date(at).toLocaleTimeString() : '';
  }
  document.getElementById('tabs').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    tab = b.dataset.v; document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b)); render();
  });

  Store.on('pub', d => { cfg = U.normConfig(d); at = Date.now(); render(); });
  Store.on('live', d => { if ((d._s || 0) < (live._s || 0)) return; live = U.normLive(d); at = Date.now(); render(); });
  Store.on('history', d => { hist = U.normHist(d); at = Date.now(); render(); });
  (async () => {
    await Store.init();
    const [p, l, h] = await Promise.all([Store.load('pub'), Store.load('live'), Store.load('history')]);
    if (!p) { $('main').innerHTML = '<p class="hint">Turnir hali sozlanmagan.</p>'; }
    else cfg = U.normConfig(p);
    live = U.normLive(l); hist = U.normHist(h); at = Date.now();
    render();
    Store.poll(10000, ['live', 'history']);
    Store.poll(120000, ['pub']);
  })();
})();
