/* Auto kills: reads the kill feed from the observer screen (screen share + OCR) and turns
   "Attacker [gun] [icon] Victim" lines into knocks / kills. Nothing touches the game itself:
   it only looks at the picture the admin already has on screen.
   Knock or kill is decided by the game rules (see AdminAPI.event), not by the icon. */
const AutoKill = (() => {
  const { esc } = U;
  const TESS = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  const st = { on: false, busy: false, mode: 'confirm', fps: 0, raw: '', err: '', prev: '', pend: [], recent: [], frames: 0 };
  let stream = null, video = null, worker = null, timer = null;
  const LS = k => 'pgo:ak:' + k;
  const get = (k, d) => { try { const v = localStorage.getItem(LS(k)); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
  const put = (k, v) => { try { localStorage.setItem(LS(k), JSON.stringify(v)); } catch (e) { /* private mode */ } };
  st.mode = get('mode', 'confirm');
  // kill-feed area as fractions of the frame (left side, under the team list) — the admin can redraw it
  let area = get('area', { x: 0, y: .3, w: .5, h: .16 });

  /* ---------- name matching ---------- */
  // letters OCR mixes up, and Cyrillic letters that look Latin, are folded together on both sides
  const FOLD = { '0': 'O', Q: 'O', D: 'O', '1': 'I', L: 'I', '|': 'I', ']': 'I', '[': 'I', '!': 'I', J: 'I', '5': 'S', $: 'S', '6': 'G', '7': 'T', '8': 'B', '2': 'Z', '4': 'A', U: 'V',
    А: 'A', В: 'B', Е: 'E', Ё: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y', Ы: 'BI', З: '3', П: 'N', Л: 'N', И: 'N', Г: 'R', Я: 'R', Ь: 'B' };
  const norm = s => String(s || '').toUpperCase().replace(/[^\p{L}\p{N}$|\][!]/gu, '').split('').map(c => FOLD[c] || c).join('');
  function lev(a, b) {
    if (a === b) return 0; const m = a.length, n = b.length; if (!m || !n) return m || n;
    let p = Array.from({ length: n + 1 }, (_, i) => i);
    for (let i = 1; i <= m; i++) { const c = [i]; for (let j = 1; j <= n; j++) c[j] = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); p = c; }
    return p[n];
  }
  const sim = (a, b) => !a || !b ? 0 : 1 - lev(a, b) / Math.max(a.length, b.length);
  let keys = [];                                                    // [{pid, tid, k:[normalized forms]}]
  function buildKeys() {
    keys = AdminAPI.roster().map(r => ({ pid: r.pid, tid: r.tid, k: [norm(r.tag + r.name), norm(r.name + r.tag), norm(r.name), r.nick && norm(r.nick), r.nick && norm(r.tag + r.nick)].filter(x => x && x.length >= 2) }));
  }
  function best(text) {
    const t = norm(text); if (t.length < 2) return null;
    let b = null;
    for (const r of keys) for (const k of r.k) { const s = sim(t, k); if (!b || s > b.s) b = { pid: r.pid, tid: r.tid, s }; }
    return b;
  }
  const T = .66;                                                    // how similar each name must be (a pair also needs a high total)
  /* one feed line -> {a, v} (attacker may be null when only one name could be read) */
  function parse(line) {
    const w = line.split(/\s+/).filter(x => norm(x).length);
    if (!w.length) return null;
    const spans = [];
    for (let i = 0; i < w.length; i++) for (let j = i + 1; j <= Math.min(w.length, i + 4); j++) {
      const m = best(w.slice(i, j).join('')); if (m && m.s >= T) spans.push({ i, j, m });
    }
    let pair = null;
    for (const A of spans) for (const V of spans) {
      if (V.i < A.j || A.m.tid === V.m.tid) continue;
      const sc = A.m.s + V.m.s; if (sc >= 1.5 && (!pair || sc > pair.sc)) pair = { sc, a: A.m.pid, v: V.m.pid };
    }
    if (pair) return pair;
    const one = spans.sort((x, y) => y.m.s - x.m.s)[0];
    return one && one.m.s >= .85 ? { a: null, v: one.m.pid, one: true } : null;
  }

  /* ---------- picture -> text ---------- */
  const cv = document.createElement('canvas'), cx = cv.getContext('2d', { willReadFrequently: true });
  function grab() {
    const W = video.videoWidth, H = video.videoHeight; if (!W || !H) return null;
    const sx = Math.round(area.x * W), sy = Math.round(area.y * H), sw = Math.round(area.w * W), sh = Math.round(area.h * H);
    const k = Math.max(1, Math.min(3, 900 / sw));                  // small text is upscaled for the reader
    cv.width = Math.round(sw * k); cv.height = Math.round(sh * k);
    cx.imageSmoothingQuality = 'high'; cx.drawImage(video, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    const im = cx.getImageData(0, 0, cv.width, cv.height), d = im.data;
    for (let i = 0; i < d.length; i += 4) {                           // keep white letters only: black text on white
      const mn = Math.min(d[i], d[i + 1], d[i + 2]), mx = Math.max(d[i], d[i + 1], d[i + 2]);
      const on = mn > 175 && mx - mn < 55; d[i] = d[i + 1] = d[i + 2] = on ? 0 : 255;
    }
    cx.putImageData(im, 0, 0);
    return cv;
  }
  function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Yuklanmadi: ' + src)); document.head.appendChild(s); }); }

  /* ---------- feed lines -> new events ----------
     A line stays on screen for a few seconds, so it is read many times: an event counts once,
     when a line (attacker->victim) shows up more times than it was on screen just before.
     It must be seen in 2 frames in a row, and it is forgotten after ~3 s off screen. */
  const seen = {};                                                    // key -> {n, cand, candN, miss}
  function track(evs) {
    const cnt = {};
    evs.forEach(e => { const k = (e.a || '-') + '>' + e.v; cnt[k] = (cnt[k] || 0) + 1; });
    const out = [];
    Object.keys(cnt).forEach(k => {
      const s = seen[k] || (seen[k] = { n: 0, candN: 0, cand: 0, miss: 0 });
      s.miss = 0;
      if (cnt[k] > s.n) { if (s.cand === cnt[k]) s.candN++; else { s.cand = cnt[k]; s.candN = 1; }
        if (s.candN >= 2) { for (let i = s.n; i < cnt[k]; i++) out.push(evs.find(e => (e.a || '-') + '>' + e.v === k)); s.n = cnt[k]; } }
      else s.cand = 0;
    });
    Object.keys(seen).forEach(k => { if (!cnt[k] && ++seen[k].miss > 4) delete seen[k]; });
    return out;
  }
  function take(e) {
    const lbl = AdminAPI.label;
    if (st.mode === 'auto' && e.a) {
      const kind = AdminAPI.event(e.a, e.v);
      if (kind) st.recent.unshift({ t: Date.now(), txt: `${lbl(e.a)} ${kind === 'kill' ? '☠' : 'N'} ${lbl(e.v)}` });
      st.recent = st.recent.slice(0, 5); return;
    }
    if (!e.a && st.mode === 'auto') return;                          // one name only: never guessed automatically
    if (st.pend.some(p => p.a === e.a && p.v === e.v)) return;
    st.pend.push({ id: U.uid(), a: e.a, v: e.v, t: Date.now() }); st.pend = st.pend.slice(-8);
    AdminAPI.render();
  }

  async function tick() {
    if (!st.on || st.busy || !video) return;
    st.busy = true; const t0 = performance.now();
    try {
      const c = grab();
      if (c) {
        const r = await worker.recognize(c);
        const lines = r.data.lines.map(l => l.text.trim()).filter(Boolean);
        st.raw = lines.join(' ⏎ '); buildKeys();
        const evs = lines.map(parse).filter(Boolean);
        track(evs).forEach(take);
        st.prev = c.toDataURL('image/png'); st.frames++;
        st.fps = Math.round(1000 / (performance.now() - t0) * 10) / 10;
        status();
      }
    } catch (e) { st.err = e.message; status(); }
    st.busy = false;
  }
  function status() {
    const el = document.getElementById('akStat'); if (el) el.innerHTML = statHtml();
    const im = document.getElementById('akPrev'); if (im && st.prev) im.src = st.prev;
  }
  const statHtml = () => st.note ? `⏳ ${esc(st.note)}` : st.err ? `<b class="bad">⚠ ${esc(st.err)}</b>` : st.on
    ? `🟢 O'qilyapti · ${st.fps} kadr/s<br><small>${esc(st.raw.slice(0, 160)) || '— hozir yozuv yo\'q —'}</small>` : '⚪ O\'chiq';

  async function start() {
    st.err = '';
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false });
    } catch (e) { st.err = 'Ekran tanlanmadi'; AdminAPI.render(); return; }
    video = document.createElement('video'); video.muted = true; video.srcObject = stream; await video.play().catch(() => {});
    stream.getVideoTracks()[0].addEventListener('ended', stop);
    st.on = true; st.note = 'O\'quvchi yuklanmoqda (bir marta, ~5 MB)…'; AdminAPI.render();
    try {
      if (!window.Tesseract) await loadScript(TESS);
      if (!worker) { worker = await Tesseract.createWorker(['eng', 'rus']); await worker.setParameters({ preserve_interword_spaces: '1' }); }
      st.note = '';
    } catch (e) { st.note = ''; st.err = 'O\'quvchi yuklanmadi: internetni tekshiring'; stop(); return; }
    clearInterval(timer); timer = setInterval(tick, 350); AdminAPI.render();
  }
  function stop() {
    st.on = false; clearInterval(timer);
    if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; video = null;
    Object.keys(seen).forEach(k => delete seen[k]); AdminAPI.render();
  }

  /* ---------- choosing the kill-feed area on a still of the screen ---------- */
  function pickArea() {
    if (!video || !video.videoWidth) return alert('Avval ekranni ulang');
    const W = video.videoWidth, H = video.videoHeight, c = document.createElement('canvas');
    c.width = W; c.height = H; c.getContext('2d').drawImage(video, 0, 0);
    const box = document.createElement('div'); box.className = 'akpick';
    box.innerHTML = `<div class="in"><p><b>Kill yozuvlari chiqadigan joyni sichqoncha bilan belgilang</b> (bir nechta qator sig'sin), keyin "Saqlash".</p><div class="pic"><img src="${c.toDataURL('image/jpeg', .8)}"><i class="sel"></i></div><div class="row"><button class="pri" data-akp="save">Saqlash</button><button data-akp="cancel">Bekor</button></div></div>`;
    document.body.appendChild(box);
    const pic = box.querySelector('.pic'), sel = box.querySelector('.sel');
    let a = Object.assign({}, area), drag = null;
    const show = () => Object.assign(sel.style, { left: a.x * 100 + '%', top: a.y * 100 + '%', width: a.w * 100 + '%', height: a.h * 100 + '%' });
    const pos = e => { const r = pic.getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) }; };
    pic.addEventListener('pointerdown', e => { drag = pos(e); pic.setPointerCapture(e.pointerId); e.preventDefault(); });
    pic.addEventListener('pointermove', e => { if (!drag) return; const p = pos(e); a = { x: Math.min(p.x, drag.x), y: Math.min(p.y, drag.y), w: Math.abs(p.x - drag.x), h: Math.abs(p.y - drag.y) }; show(); });
    pic.addEventListener('pointerup', () => { drag = null; });
    box.addEventListener('click', e => {
      const k = e.target.dataset.akp; if (!k) return;
      if (k === 'save' && a.w > .02 && a.h > .02) { area = a; put('area', area); }
      box.remove(); AdminAPI.render();
    });
    show();
  }

  /* ---------- panel ---------- */
  function html() {
    const lbl = AdminAPI.label;
    const pend = st.pend.map(p => {
      const kind = p.a ? AdminAPI.kind(p.a, p.v) : null;
      return `<div class="akp"><span>${p.a ? esc(lbl(p.a)) : '<i>?</i>'} <b class="${kind === 'kill' ? 'k' : 'n'}">${p.a ? (kind === 'kill' ? '☠' : kind === 'knock' ? 'N' : '–') : '?'}</b> ${esc(lbl(p.v))}</span>${p.a && kind ? `<button class="pri" data-ak="ok" data-id="${p.id}">✔</button>` : ''}<button data-ak="no" data-id="${p.id}">✕</button></div>`;
    }).join('');
    return `<div class="box ak"><h3>🤖 Avto-kill (ekrandan o'qish)</h3>
      <div class="row">${st.on ? '<button data-ak="stop">⏹ To\'xtatish</button>' : '<button class="pri" data-ak="start" style="flex:1">🖥 Ekranni ulash</button>'}<button data-ak="area" ${st.on ? '' : 'disabled'}>▭ Joyni belgilash</button></div>
      <div class="row"><button class="${st.mode === 'confirm' ? 'on' : ''}" data-ak="mode" data-v="confirm">✋ Tasdiqlab</button><button class="${st.mode === 'auto' ? 'on' : ''}" data-ak="mode" data-v="auto">⚡ To'liq avto</button></div>
      <div id="akStat" class="hint" style="margin:4px 0">${statHtml()}</div>
      ${st.on ? `<img id="akPrev" class="akprev" src="${st.prev || ''}" alt="">` : ''}
      ${pend ? `<div class="akl">${pend}</div><div class="row"><button data-ak="okAll" class="pri">✔ Hammasini tasdiqlash</button><button data-ak="noAll">✕ Hammasini rad</button></div>` : ''}
      ${st.recent.length ? `<div class="akl">${st.recent.map(r => `<div class="akp"><span>${esc(r.txt)}</span></div>`).join('')}</div>` : ''}
      ${st.on ? '' : '<p class="hint">Observer ekranini (yoki OBS proyektorini) tanlang, keyin kill yozuvlari chiqadigan joyni belgilang. Nok yoki kill o\'yin qoidasidan aniqlanadi. Xato bo\'lsa "Oxirgi harakatlar"dan tuzating.</p>'}</div>`;
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-ak]'); if (!b) return;
    const k = b.dataset.ak, id = b.dataset.id;
    if (k === 'start') start();
    else if (k === 'stop') stop();
    else if (k === 'area') pickArea();
    else if (k === 'mode') { st.mode = b.dataset.v; put('mode', st.mode); AdminAPI.render(); }
    else if (k === 'ok' || k === 'no') { const p = st.pend.find(x => x.id === id); st.pend = st.pend.filter(x => x.id !== id); if (k === 'ok' && p) AdminAPI.event(p.a, p.v); AdminAPI.render(); }
    else if (k === 'okAll') { const l = st.pend; st.pend = []; l.forEach(p => p.a && AdminAPI.event(p.a, p.v)); AdminAPI.render(); }
    else if (k === 'noAll') { st.pend = []; AdminAPI.render(); }
  });
  return { html, _parse: line => { buildKeys(); return parse(line); }, _norm: norm };
})();
