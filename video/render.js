// HTML animatsiyani kadrma-kadr suratga olib, ovozli MP4 video yasaydi.
// Ishlatish:  node video/render.js internet           (to'liq video)
//             node video/render.js rocket
//             node video/render.js rocket preview     (har sahnadan 2 kadr — tez tekshirish)
// Kerak: Node.js, playwright, ffmpeg, python3 + numpy (+ scipy raketa uchun).
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FPS = 30;
const dir = __dirname;
const framesDir = path.join(dir, '.frames');

function audioLength(file) {
  if (!fs.existsSync(file)) return 0;
  return parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', file]).toString());
}

const PROJECTS = {
  // Diktorli video: sahnalar diktor ovozi uzunligiga moslashadi (audio/vo0..5.mp3)
  internet: {
    page: 'internet.html', audio: 'make_audio.py', out: 'how-the-internet-works.mp4',
    durations: () => [5, 5.5, 5.5, 6, 5.5, 7].map((m, i) => {
      const vo = audioLength(path.join(dir, 'audio', `vo${i}.mp3`));
      return Math.round(Math.max(m, vo + 0.35 + 0.6) * 10) / 10;
    })
  },
  // Faqat SFX: davomiyliklar sahifaning o'zida belgilangan
  rocket: { page: 'rocket.html', audio: 'rocket_audio.py', out: 'how-a-rocket-reaches-orbit.mp4', durations: null }
};

const name = process.argv[2] || 'internet';
const preview = process.argv[3] === 'preview';
const cfg = PROJECTS[name];
if (!cfg) { console.error('Noma\'lum loyiha:', name, '— mavjudlari:', Object.keys(PROJECTS).join(', ')); process.exit(1); }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.goto('file://' + path.join(dir, cfg.page) + '?render');
  await page.evaluate(() => window.ready);
  let durs;
  if (cfg.durations) { durs = cfg.durations(); await page.evaluate(d => window.setDurations(d), durs); }
  else durs = await page.evaluate(() => window.SCENE_DURS);
  const duration = await page.evaluate(() => window.DURATION);
  console.log('sahnalar:', durs.join(', '), `= ${duration.toFixed(1)} s`);

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
    fs.writeFileSync(path.join(framesDir, `f_${String(i).padStart(4, '0')}.png`), Buffer.from(data.split(',')[1], 'base64'));
    if (i % 300 === 0) console.log(`kadr ${i}/${times.length}`);
  }
  await browser.close();

  if (preview) { console.log('preview kadrlar:', framesDir); return; }

  const wav = path.join(framesDir, 'mix.wav');
  execFileSync('python3', [path.join(dir, cfg.audio), JSON.stringify(durs), wav], { stdio: 'inherit' });

  const outFile = path.join(dir, cfg.out);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS),
    '-i', path.join(framesDir, 'f_%04d.png'), '-i', wav,
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow',
    '-c:a', 'aac', '-b:a', '192k', '-shortest',
    '-movflags', '+faststart', outFile], { stdio: 'inherit' });
  fs.rmSync(framesDir, { recursive: true, force: true });
  console.log('Tayyor:', outFile);
})();
