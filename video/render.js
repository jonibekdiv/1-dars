// internet.html animatsiyasini kadrma-kadr suratga olib, ovozli MP4 video yasaydi.
// Ishlatish:  node video/render.js            (to'liq video)
//             node video/render.js preview    (har bir sahnadan 2 ta kadr — tez tekshirish uchun)
// Kerak: Node.js, playwright, ffmpeg, python3 + numpy.
// Diktor ovozi: video/audio/vo0.mp3 ... vo5.mp3 (har bir sahna uchun bittadan).
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FPS = 30;
const dir = __dirname;
const framesDir = path.join(dir, '.frames');
const outFile = path.join(dir, 'how-the-internet-works.mp4');
const preview = process.argv[2] === 'preview';

// Har sahnaning eng kam davomiyligi; diktor uzunroq gapirsa, sahna cho'ziladi.
const MIN_DUR = [5, 5.5, 5.5, 6, 5.5, 7];
const VO_DELAY = 0.35, VO_TAIL = 0.6;

function audioLength(file) {
  if (!fs.existsSync(file)) return 0;
  return parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', file]).toString());
}

(async () => {
  const durs = MIN_DUR.map((m, i) => {
    const vo = audioLength(path.join(dir, 'audio', `vo${i}.mp3`));
    return Math.round(Math.max(m, vo + VO_DELAY + VO_TAIL) * 10) / 10;
  });
  console.log('sahna davomiyliklari:', durs.join(', '));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.goto('file://' + path.join(dir, 'internet.html') + '?render');
  await page.evaluate(() => window.ready);
  await page.evaluate(d => window.setDurations(d), durs);
  const duration = await page.evaluate(() => window.DURATION);

  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir);

  let times;
  if (preview) {
    let acc = 0; times = [];
    for (const d of durs) { times.push(acc + d * 0.3, acc + d * 0.85); acc += d; }
  } else {
    times = Array.from({ length: Math.round(duration * FPS) }, (_, i) => i / FPS);
  }

  for (let i = 0; i < times.length; i++) {
    const data = await page.evaluate(t => {
      window.renderFrame(t);
      return document.getElementById('c').toDataURL('image/png');
    }, times[i]);
    const name = `f_${String(i).padStart(4, '0')}.png`;
    fs.writeFileSync(path.join(framesDir, name), Buffer.from(data.split(',')[1], 'base64'));
    if (i % 120 === 0) console.log(`kadr ${i}/${times.length}`);
  }
  await browser.close();

  if (preview) { console.log('preview kadrlar:', framesDir); return; }

  const wav = path.join(framesDir, 'mix.wav');
  execFileSync('python3', [path.join(dir, 'make_audio.py'), JSON.stringify(durs), wav], { stdio: 'inherit' });

  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS),
    '-i', path.join(framesDir, 'f_%04d.png'), '-i', wav,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow',
    '-c:a', 'aac', '-b:a', '192k', '-shortest',
    '-movflags', '+faststart', outFile], { stdio: 'inherit' });
  fs.rmSync(framesDir, { recursive: true, force: true });
  console.log('Tayyor:', outFile, `(${duration.toFixed(1)} s)`);
})();
