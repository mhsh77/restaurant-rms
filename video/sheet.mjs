// Contact sheet for checking a render.
//   node sheet.mjs <video.mp4> <out.png> t1 t2 …        (seconds)
//   node sheet.mjs <name> <out.png> 0.5 [0.9]             (fraction through every scene, from timeline.json)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
let [video, out, ...times] = process.argv.slice(2);
if (!video.endsWith('.mp4')) {
  const dir = path.join('out', video);
  const tl = JSON.parse(fs.readFileSync(path.join(dir, 'timeline.json'), 'utf8'));
  video = fs.existsSync(path.join(dir, `${video}.mp4`)) ? path.join(dir, `${video}.mp4`) : path.join(dir, `${video}-draft.mp4`);
  times = tl.flatMap((s) => times.map((f) => (s.start + s.duration * Number(f)).toFixed(2)));
}
const tmp = fs.mkdtempSync(path.join(path.dirname(out), 'sheet-'));
times.forEach((t, i) => execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', t, '-i', video, '-frames:v', '1', '-vf', 'scale=800:-1', path.join(tmp, `${String(i).padStart(2, '0')}.png`)]));
const cols = 2, rows = Math.ceil(times.length / cols);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', path.join(tmp, '%02d.png'), '-vf', `tile=${cols}x${rows}:padding=6:color=white`, '-frames:v', '1', out]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(times.join(' '));
