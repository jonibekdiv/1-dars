// internet.html animatsiyasini kadrma-kadr suratga olib, MP4 video yasaydi.
// Ishlatish:  node video/render.js            (to'liq video)
//             node video/render.js preview    (har bir sahnadan bitta kadr — tez tekshirish uchun)
// Kerak: Node.js, playwright, ffmpeg.
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FPS = 30;
const dir = __dirname;
const framesDir = path.join(dir, '.frames');
const outFile = path.join(dir, 'internet-qanday-ishlaydi.mp4');
const preview = process.argv[2] === 'preview';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.goto('file://' + path.join(dir, 'internet.html') + '?render');
  await page.evaluate(() => window.ready);
  const duration = await page.evaluate(() => window.DURATION);

  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir);

  const times = preview
    ? [1, 4.5, 6, 8, 11, 13.5, 17, 20, 23, 25.5, 30, 33.6]
    : Array.from({ length: Math.round(duration * FPS) }, (_, i) => i / FPS);

  for (let i = 0; i < times.length; i++) {
    const data = await page.evaluate(t => {
      window.renderFrame(t);
      return document.getElementById('c').toDataURL('image/png');
    }, times[i]);
    const name = `f_${String(i).padStart(4, '0')}.png`;
    fs.writeFileSync(path.join(framesDir, name), Buffer.from(data.split(',')[1], 'base64'));
    if (i % 60 === 0) console.log(`kadr ${i}/${times.length}`);
  }
  await browser.close();

  if (preview) { console.log('preview kadrlar:', framesDir); return; }

  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS),
    '-i', path.join(framesDir, 'f_%04d.png'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow',
    '-movflags', '+faststart', outFile], { stdio: 'inherit' });
  fs.rmSync(framesDir, { recursive: true, force: true });
  console.log('Tayyor:', outFile, `(${duration} s)`);
})();
