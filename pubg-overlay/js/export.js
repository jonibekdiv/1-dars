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

    // title
    const size = Math.min(70, Math.floor(800 / (o.title.length * .8)));
    text(c, o.title, 960, 88, `${size}px ${SLAB}`, 'center');
    c.font = `600 33px ${FONT}`;
    text(c, o.sub.filter(Boolean).join('  ▪  ').split('').join(' '), 960, 150, `600 30px ${FONT}`, 'center', '#fff', 820);
    // brand (top right)
    if (brand) contain(c, brand, 1486, 66, 84, 84);
    text(c, o.brand.title, brand ? 1582 : 1600, 108, `800 22px ${FONT}`, brand ? 'left' : 'center', '#fff', brand ? 140 : 230);

    // leading team
    const hx = 174, hy = 242, hw = 862, hh = 657;
    if (own) { c.shadowColor = 'transparent'; const g = c.createLinearGradient(0, hy, 0, hy + hh); g.addColorStop(0, 'rgba(0,0,0,.25)'); g.addColorStop(1, 'rgba(120,10,25,.75)'); c.fillStyle = g; c.fillRect(hx, hy, hw, hh); c.shadowColor = 'rgba(0,0,0,.55)'; }
    c.save(); c.beginPath(); c.rect(hx, hy, hw, hh); c.clip();
    if (photos.length) {
      const n = photos.length, mid = Math.floor((n - 1) / 2), w = hw * .30, step = w * .70, total = step * (n - 1) + w, x0 = hx + (hw - total) / 2;
      const order = photos.map((p, i) => i).sort((a, b) => Math.abs(b - mid) - Math.abs(a - mid));   // centre drawn last = in front
      order.forEach(i => { const h = hh * (1 - Math.abs(i - mid) * .09); coverTop(c, photos[i], x0 + i * step, hy + hh - h, w, h); });
    } else if (hlogo) contain(c, hlogo, hx + hw * .2, hy + 40, hw * .6, hh * .62);
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
    const tx = 1085, tw = 653, n = o.rows.length, th = Math.max(18, Math.min(62, Math.floor(574 / (n + (o.note ? 2 : 1)))));
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
      if (r.mark) { c.save(); c.shadowColor = 'transparent'; c.fillStyle = r.mark === 'champ' ? 'rgba(255,210,74,.28)' : 'rgba(255,210,74,.13)'; c.fillRect(tx, y + 1, tw, th - 2); c.restore(); }
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
      text(c, String(r.tag).toUpperCase() + (r.mark === 'champ' ? '  ★' : ''), col.nm, cy + 1, `700 ${fs}px ${FONT}`, 'left', r.mark ? '#ffd24a' : '#fff', 130);
      r.cols.forEach((v, k) => text(c, String(v), col.c[k], cy + 1, `${k === 3 ? 800 : 700} ${fs}px ${FONT}`, 'center'));
      if (i < n - 1) { c.save(); c.shadowColor = 'transparent'; c.fillStyle = 'rgba(255,255,255,.13)'; c.fillRect(tx, y + th - 1, tw, 1); c.restore(); }
      y += th;
    });

    // sponsors
    if (sponsors.length) {
      const sh = 46, gap = 44, ws = sponsors.map(s => Math.min(220, s.width * sh / s.height));
      let sx = 967 - (ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1)) / 2;
      sponsors.forEach((s, i) => { contain(c, s, sx, 1008 - sh / 2, ws[i], sh); sx += ws[i] + gap; });
    }
    return new Promise(res => { try { cv.toBlob(res, 'image/png'); } catch (e) { res(null); } });
  }
  return { ranking };
})();
