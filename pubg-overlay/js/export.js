/* Draws a ranking picture (1920x1080 PNG) for social media, in the same layout as the stream scene */
const Exporter = (() => {
  const load = src => new Promise(res => {
    if (!src) return res(null);
    const im = new Image();
    if (!/^data:/.test(src)) im.crossOrigin = 'anonymous';
    im.onload = () => res(im); im.onerror = () => res(null);
    im.src = src;
  });
  const FONT = "'Barlow Condensed', 'Arial Narrow', sans-serif", SLAB = "'Alfa Slab One', Rockwell, Georgia, serif";
  function contain(c, im, x, y, w, h) {
    if (!im) return;
    const iw = im.naturalWidth || im.width || w, ih = im.naturalHeight || im.height || h;
    const s = Math.min(w / iw, h / ih), dw = iw * s, dh = ih * s;
    c.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  function coverTop(c, im, x, y, w, h) {                       // like object-fit: cover; object-position: top
    const iw = im.naturalWidth || im.width || w, ih = im.naturalHeight || im.height || h, s = Math.max(w / iw, h / ih);
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();      // clip instead of a source rectangle: works for SVG too
    c.drawImage(im, x + (w - iw * s) / 2, y, iw * s, ih * s);
    c.restore();
  }
  function text(c, str, x, y, font, align, color, maxW) {
    c.font = font; c.textAlign = align || 'left'; c.fillStyle = color || '#fff'; c.textBaseline = 'middle';
    if (maxW) c.fillText(str, x, y, maxW); else c.fillText(str, x, y);
  }

  /* Liquid band like on the stream: glossy red body with hanging drips and falling drops */
  function liquid(c, x, y, w, h, seed) {
    let k = seed >>> 0 || 7; const rnd = () => (k = (Math.imul(k, 1103515245) + 12345) >>> 0) / 4294967296;
    const r = Math.min(10, h / 2);
    const body = () => { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); };
    const g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#ff4a5e'); g.addColorStop(.46, '#d0142c'); g.addColorStop(1, '#810c1b');
    c.save(); c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = 12; c.shadowOffsetY = 4;
    c.fillStyle = g; body(); c.fill(); c.shadowColor = 'transparent';
    // drips: a neck that widens into a rounded tip, plus a separate falling drop
    const n = Math.max(3, Math.round(w / 110));
    for (let i = 0; i < n; i++) {
      const cx = x + w * (.07 + .86 * (i + .15 + rnd() * .7) / n), dw = 10 + rnd() * 9, dh = 12 + rnd() * 22, top = y + h - 3;
      const dg = c.createLinearGradient(cx - dw / 2, 0, cx + dw / 2, 0); dg.addColorStop(0, '#810c1b'); dg.addColorStop(.4, '#d0142c'); dg.addColorStop(1, '#4c0610');
      c.fillStyle = dg; c.beginPath();
      c.moveTo(cx - dw * .9, top); c.quadraticCurveTo(cx - dw * .35, top + 2, cx - dw * .32, top + dh * .55);
      c.quadraticCurveTo(cx - dw * .52, top + dh, cx, top + dh); c.quadraticCurveTo(cx + dw * .52, top + dh, cx + dw * .32, top + dh * .55);
      c.quadraticCurveTo(cx + dw * .35, top + 2, cx + dw * .9, top); c.closePath(); c.fill();
      if (rnd() > .45) { const dy = top + dh + 6 + rnd() * 16, rr = dw * .3; const rg = c.createRadialGradient(cx - rr * .3, dy - rr * .3, 1, cx, dy, rr * 1.2); rg.addColorStop(0, '#ff4a5e'); rg.addColorStop(1, '#4c0610'); c.fillStyle = rg; c.beginPath(); c.ellipse(cx, dy, rr, rr * 1.2, 0, 0, Math.PI * 2); c.fill(); }
    }
    // gloss + sheen
    const gl = c.createLinearGradient(0, y, 0, y + h * .5); gl.addColorStop(0, 'rgba(255,255,255,.5)'); gl.addColorStop(1, 'rgba(255,255,255,.04)');
    c.fillStyle = gl; c.beginPath(); c.roundRect ? c.roundRect(x + w * .025, y + 3, w * .95, h * .44, h * .22) : c.rect(x + w * .025, y + 3, w * .95, h * .44); c.fill();
    const sh = c.createLinearGradient(x + w * .55, 0, x + w * .8, 0); sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(.5, 'rgba(255,255,255,.2)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = sh; body(); c.fill();
    c.restore();
  }

  async function ranking(o) {
    try { await Promise.all([document.fonts.load(`82px ${SLAB}`), document.fonts.load(`700 40px ${FONT}`), document.fonts.load(`800 40px ${FONT}`)]); } catch (e) { /* fall back to system fonts */ }
    const cv = document.createElement('canvas'); cv.width = 1920; cv.height = 1080;
    const c = cv.getContext('2d');
    const own = !!o.bg;
    const [bg, ribbon, brand, hflag, hlogo] = await Promise.all([load(o.bg || 'img/bg-rank.webp'), load(own ? '' : 'img/ribbon.png'), load(o.brand.logo), load(o.hero.flag), load(o.hero.logo)]);
    const photos = (await Promise.all(o.hero.photos.slice(0, 5).map(load))).filter(Boolean);
    const sponsors = (await Promise.all(o.sponsors.slice(0, 6).map(load))).filter(Boolean);
    const rowImgs = await Promise.all(o.rows.map(r => Promise.all([load(r.flag), load(r.logo)])));

    c.fillStyle = '#1b1b20'; c.fillRect(0, 0, 1920, 1080);
    if (bg) c.drawImage(bg, 0, 0, 1920, 1080);
    c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = 14; c.shadowOffsetY = 4;

    // brand (position / size / name from the settings)
    const B = Object.assign({ pos: 'tr', size: 'm', name: true }, o.brand), bname = B.name ? o.brand.title : '';
    const SZ = { s: [190, 70, 20], m: [250, 104, 25], l: [300, 140, 30] }[B.size] || [250, 104, 25];
    const fitImg = (im, mw, mh) => { if (!im) return [0, 0]; const iw = im.naturalWidth || im.width || mw, ih = im.naturalHeight || im.height || mh, k = Math.min(mw / iw, mh / ih); return [iw * k, ih * k]; };
    if (B.pos === 'tr' || B.pos === 'tl') {
      const cx = B.pos === 'tr' ? 1600 : 300, [w, h] = fitImg(brand, SZ[0], SZ[1]);
      const total = h + (bname ? (h ? 8 : 0) + SZ[2] : 0); let y = 30 + Math.max(0, (128 - total) / 2);
      if (brand) { c.drawImage(brand, cx - w / 2, y, w, h); y += h + 8; }
      if (bname) text(c, bname.toUpperCase(), cx, y + SZ[2] / 2, `800 ${SZ[2]}px ${FONT}`, 'center', '#fff', SZ[0]);
    } else if (B.pos === 'top') {
      const [w, h] = fitImg(brand, 360, SZ[1] * .62); c.font = `800 ${SZ[2] + 4}px ${FONT}`;
      const tw = bname ? Math.min(600, c.measureText(bname.toUpperCase()).width) : 0, gap = brand && bname ? 16 : 0;
      let x = 960 - (w + gap + tw) / 2; const cy = 18 + Math.max(h, SZ[2] + 4) / 2;
      if (brand) { c.drawImage(brand, x, cy - h / 2, w, h); x += w + gap; }
      if (bname) text(c, bname.toUpperCase(), x, cy, `800 ${SZ[2] + 4}px ${FONT}`, 'left', '#fff', 600);
    }
    // title (moves down under a logo placed at the top centre)
    const corner = B.pos === 'tr' || B.pos === 'tl', topBrand = B.pos === 'top';
    const size = topBrand ? 58 : Math.min(70, Math.floor((corner ? 800 : 1240) / (o.title.length * .8)));
    const ty = topBrand ? 150 : 88;
    text(c, o.title, 960, ty, `${size}px ${SLAB}`, 'center');
    text(c, o.sub.filter(Boolean).join('  ▪  ').split('').join(' '), 960, ty + (topBrand ? 50 : 62), `600 ${topBrand ? 26 : 30}px ${FONT}`, 'center', '#fff', corner ? 820 : 1300);

    // leading team
    const hx = 174, hy = 242, hw = 862, hh = 657;
    if (own) { c.shadowColor = 'transparent'; const g = c.createLinearGradient(0, hy, 0, hy + hh); g.addColorStop(0, 'rgba(0,0,0,.25)'); g.addColorStop(1, 'rgba(120,10,25,.75)'); c.fillStyle = g; c.fillRect(hx, hy, hw, hh); c.shadowColor = 'rgba(0,0,0,.55)'; }
    c.save(); c.beginPath(); c.rect(hx, hy, hw, hh); c.clip();
    if (photos.length) {
      const n = photos.length, mid = Math.floor((n - 1) / 2), w = hw * .30, step = w * .70, total = step * (n - 1) + w, x0 = hx + (hw - total) / 2;
      const order = photos.map((p, i) => i).sort((a, b) => Math.abs(b - mid) - Math.abs(a - mid));   // centre drawn last = in front
      order.forEach(i => { const h = hh * (1 - Math.abs(i - mid) * .09); coverTop(c, photos[i], x0 + i * step, hy + hh - h, w, h); });
    } else if (hlogo) contain(c, hlogo, hx + hw * .2, hy + 40, hw * .6, hh * .62);
    else if (o.hero.tag) {
      const pnl = await load('img/panel.png');
      if (pnl) c.drawImage(pnl, hx + hw / 2 - 190, hy + 40, 380, 300);
      text(c, String(o.hero.tag).toUpperCase(), hx + hw / 2, hy + 192, `800 120px ${FONT}`, 'center', '#fff', 320);
    }
    c.restore();
    if (ribbon) c.drawImage(ribbon, 315, 705, 605, 213);
    else { const g = c.createLinearGradient(315, 0, 920, 0); g.addColorStop(0, '#ff4a5e'); g.addColorStop(.4, '#d0142c'); g.addColorStop(1, '#810c1b'); c.fillStyle = g; c.fillRect(330, 752, 580, 110); }
    // "#1 | flag NAME" centred on the ribbon
    c.font = `800 54px ${FONT}`; const nameW = Math.min(300, c.measureText(o.hero.name.toUpperCase()).width);
    const tot = 96 + 24 + (hflag ? 60 + 18 : 0) + nameW; let x = 618 - tot / 2;
    text(c, '#1', x, 810, `800 70px ${FONT}`); x += 96;
    c.fillStyle = 'rgba(255,255,255,.6)'; c.fillRect(x, 772, 2, 76); x += 24;
    if (hflag) { c.drawImage(hflag, x, 790, 60, 40); x += 78; }
    text(c, o.hero.name.toUpperCase(), x, 812, `800 54px ${FONT}`, 'left', '#fff', 300);

    // table
    const tx = 1085, tw = 653, n = o.rows.length, th = Math.max(18, Math.min(62, Math.floor(574 / (n + (o.note ? 2 : 1) + .45))));
    const col = { mv: tx + 13, rk: tx + 59, fl: tx + 114, lg: tx + 160, nm: tx + 194, c: [tw - 316, tw - 234, tw - 144, tw - 53].map(v => tx + v) };
    let y = 298 + Math.min(th, 44) / 2;
    const hf = `700 16px ${FONT}`;
    text(c, 'RANK', col.rk, y, hf, 'center'); text(c, 'TEAMS', col.nm, y, hf);
    ['WWCD', 'PLACE PTS.', 'ELIMS.', 'TOTAL PTS.'].forEach((h, i) => text(c, h, col.c[i], y, hf, 'center'));
    y += Math.min(th, 44) / 2;
    c.fillStyle = 'rgba(255,255,255,.5)'; c.fillRect(tx, y - 1, tw, 2);
    if (o.note) { text(c, o.note.split('').join(' '), tx + tw / 2, y + th / 2, `700 ${Math.round(th * .42)}px ${FONT}`, 'center', '#ffd24a'); y += th; }
    const fs = Math.round(th * .62);
    o.rows.forEach((r, i) => {
      const cy = y + th / 2, [fl, lg] = rowImgs[i];
      if (i === 0) liquid(c, tx - 4, y + 2, tw + 8, th - 4, 12345 + n);
      if (r.mark && i > 0) { c.save(); c.shadowColor = 'transparent'; c.fillStyle = r.mark === 'champ' ? 'rgba(255,210,74,.28)' : 'rgba(255,210,74,.13)'; c.fillRect(tx, y + 1, tw, th - 2); c.restore(); }
      if (r.mv !== null) {
        c.save(); c.shadowColor = 'transparent';
        if (r.mv > 0) { c.fillStyle = '#ff4a5e'; c.beginPath(); c.moveTo(col.mv - 8, cy + 6); c.lineTo(col.mv + 8, cy + 6); c.lineTo(col.mv, cy - 7); c.fill(); }
        else if (r.mv < 0) { c.fillStyle = '#9aa0aa'; c.beginPath(); c.moveTo(col.mv - 8, cy - 6); c.lineTo(col.mv + 8, cy - 6); c.lineTo(col.mv, cy + 7); c.fill(); }
        else { c.fillStyle = 'rgba(255,255,255,.7)'; c.fillRect(col.mv - 8, cy - 1, 16, 3); }
        c.restore();
      }
      text(c, '#' + r.rank, col.rk, cy, `800 ${fs}px ${FONT}`, 'center');
      const fw = Math.min(38, th * .66), fh = fw * .66, ls = Math.min(44, th - 10);
      if (fl) c.drawImage(fl, col.fl - fw / 2, cy - fh / 2, fw, fh);
      if (lg) contain(c, lg, col.lg - ls / 2, cy - ls / 2, ls, ls);
      text(c, String(r.tag).toUpperCase() + (r.mark === 'champ' ? '  ★' : ''), col.nm, cy + 1, `700 ${fs}px ${FONT}`, 'left', r.mark && i > 0 ? '#ffd24a' : '#fff', 130);
      r.cols.forEach((v, k) => text(c, String(v), col.c[k], cy + 1, `${k === 3 ? 800 : 700} ${fs}px ${FONT}`, 'center'));
      if (i > 0 && i < n - 1) { c.save(); c.shadowColor = 'transparent'; c.fillStyle = 'rgba(255,255,255,.13)'; c.fillRect(tx, y + th - 1, tw, 1); c.restore(); }
      y += th + (i === 0 ? Math.round(th * .45) : 0);
    });

    // sponsors
    if (B.pos === 'bottom' && (brand || bname)) sponsors.unshift(brand || null);   // brand leads the sponsor strip
    if (sponsors.length) {
      const sh = 46, gap = 44, ws = sponsors.map(s => s ? Math.min(220, (s.naturalWidth || s.width) * sh / (s.naturalHeight || s.height)) : 0);
      let sx = 967 - (ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1)) / 2;
      sponsors.forEach((s, i) => {
        if (s) contain(c, s, sx, 1008 - sh / 2, ws[i], sh);
        sx += ws[i] + gap;
        if (i === 0 && B.pos === 'bottom' && bname) { c.font = `800 22px ${FONT}`; const tw = c.measureText(bname.toUpperCase()).width; text(c, bname.toUpperCase(), sx - gap + 12, 1008, `800 22px ${FONT}`); sx += tw + 12; }
      });
    }
    return new Promise(res => { try { cv.toBlob(res, 'image/png'); } catch (e) { res(null); } });
  }
  return { ranking };
})();
