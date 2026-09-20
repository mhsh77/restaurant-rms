// Builds the final MP4 for one video from its captured frames and the voice clips.
//
//   node assemble.mjs roadmap
//
// Voice: audio/<name>/01.mp3, 02.mp3, … — one clip per narration paragraph (any of
// mp3 / wav / m4a / aac / ogg / flac / opus). Each scene is fitted to its own clip, so
// nothing has to be synced by hand and a slow or fast voice cannot drift.
//
// No clips yet → a silent draft (<name>-draft.mp4) timed by the estimated reading speed.
// One long file instead (audio/<name>/full.mp3) → split at its N-1 longest pauses.
//
// Fitting rule per scene: the voice is never resampled. If the voice is longer than the
// footage, the footage is slowed down by at most 25% and the last frame is held for the
// rest; if it is shorter, the footage plays faster.

import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readNarration, estimateSeconds } from './narration.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAME = process.argv[2];
if (!NAME) {
  console.error('usage: node assemble.mjs <name>');
  process.exit(1);
}

const FPS = 30;
const LEAD = 0.35; // silence before each paragraph
const TAIL = 0.65; // silence after each paragraph
const MAX_STRETCH = 1.25;
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus'];

const OUT = path.join(HERE, 'out', NAME);
const TMP = path.join(OUT, 'tmp');
const AUDIO_DIR = path.join(HERE, 'audio', NAME);

const ff = (args, opts = {}) => execFileSync('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const probeDuration = (file) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]).toString().trim());
const snap = (s) => Math.round(s * FPS) / FPS;

function findClip(id) {
  for (const ext of AUDIO_EXT) {
    const f = path.join(AUDIO_DIR, `${id}.${ext}`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

/**
 * Split one long narration file into its paragraphs.
 *
 * Every cut must sit in a pause. Among all ordered choices of pauses, pick the one that
 * best balances two things: paragraph breaks are usually the longer pauses, and each
 * paragraph's length should match its share of the words (the voice keeps a steady pace).
 * Solved exactly by dynamic programming over (paragraph, pause).
 */
export function planSplit(text, total, words, fixed = {}) {
  const n = words.length;
  const starts = [...text.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...text.matchAll(/silence_end: ([\d.]+) \| silence_duration: ([\d.]+)/g)].map((m) => ({ end: Number(m[1]), dur: Number(m[2]) }));
  // trailing silence is not speech: measure pace on the spoken part only
  // (a silence running to the end of the file has a start but no end)
  let spoken = total;
  if (starts.length > ends.length) spoken = starts.at(-1);
  else if (ends.length && Math.abs(ends.at(-1).end - total) < 0.2) spoken = starts[ends.length - 1];
  const gaps = ends
    .map((e, i) => ({ mid: (starts[i] + Math.min(e.end, spoken)) / 2, dur: e.dur }))
    .filter((g) => g.mid > 0.5 && g.mid < spoken - 0.5);
  const sumWords = words.reduce((x, y) => x + y, 0);
  const perWord = spoken / sumWords;
  const PACE = 12; // cost of a paragraph being 100% too long/short, squared
  const segCost = (from, to, i) => {
    const want = words[i] * perWord;
    const dev = (to - from - want) / want;
    return PACE * dev * dev;
  };
  const pts = [{ mid: 0, dur: 0 }, ...gaps, { mid: spoken, dur: 0 }];
  const G = pts.length;
  const INF = Infinity;
  // dp[i][g]: best cost with the end of paragraph i (0-based) placed at point g
  const dp = Array.from({ length: n }, () => new Float64Array(G).fill(INF));
  const from = Array.from({ length: n }, () => new Int32Array(G).fill(-1));
  // fixed[k] = seconds: paragraph k (1-based) is known to start there (from cuts.json)
  const allowed = (i, g) => fixed[i + 2] === undefined || g === G - 1 || Math.abs(pts[g].mid - fixed[i + 2]) < 0.4;
  for (let g = 1; g < G; g++) if (allowed(0, g)) dp[0][g] = segCost(0, pts[g].mid, 0) - Math.log(pts[g].dur + 0.05);
  for (let i = 1; i < n; i++) {
    for (let g = i + 1; g < G; g++) {
      if (!allowed(i, g)) continue;
      const reward = g === G - 1 ? 0 : -Math.log(pts[g].dur + 0.05);
      for (let h = i; h < g; h++) {
        if (dp[i - 1][h] === INF) continue;
        const c = dp[i - 1][h] + segCost(pts[h].mid, pts[g].mid, i) + reward;
        if (c < dp[i][g]) {
          dp[i][g] = c;
          from[i][g] = h;
        }
      }
    }
  }
  if (dp[n - 1][G - 1] === INF) throw new Error('not enough pauses to split on — please send one file per paragraph');
  const cut = [total];
  let g = G - 1;
  for (let i = n - 1; i > 0; i--) {
    g = from[i][g];
    cut.unshift(pts[g].mid);
  }
  cut.unshift(0);
  return cut;
}

function splitFull(original, paragraphs) {
  // TTS sometimes stalls: 10–30 s holes mid-file, minutes of silence at the end. Shorten
  // every silence to at most 2 s first, so pauses and paragraph lengths mean something.
  const file = path.join(TMP, 'narration-normalised.wav');
  ff(['-i', original, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=-1:stop_duration=2:stop_threshold=-45dB:stop_silence=2', file]);
  // silencedetect reports on stderr
  const text = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'silencedetect=noise=-38dB:d=0.3', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const total = probeDuration(file);
  const words = paragraphs.map((p) => p.text.split(/\s+/).length);
  // audio/<name>/cuts.json: {"3": 26.6} pins where paragraph 3 starts, when a check found a wrong cut
  const fixedFile = path.join(AUDIO_DIR, 'cuts.json');
  const fixed = fs.existsSync(fixedFile) ? JSON.parse(fs.readFileSync(fixedFile, 'utf8')) : {};
  const cuts = planSplit(text, total, words, fixed);
  const clips = [];
  const totalWords = words.reduce((x, y) => x + y, 0);
  for (let i = 0; i < paragraphs.length; i++) {
    const out = path.join(TMP, `split-${paragraphs[i].id}.wav`);
    ff(['-i', file, '-ss', cuts[i].toFixed(3), '-to', cuts[i + 1].toFixed(3), '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse', out]);
    clips.push(out);
    const share = (cuts[i + 1] - cuts[i]) / total / (words[i] / totalWords);
    console.log(`  split [${paragraphs[i].id}] ${cuts[i].toFixed(1)}–${cuts[i + 1].toFixed(1)}s  pace vs average ×${share.toFixed(2)}`);
  }
  // For checking the cuts by ear or by transcription: the opening 3 s of every paragraph,
  // separated by a short beep → out/<name>/split-check.wav
  const inputs = clips.flatMap((c) => ['-i', c]);
  const beep = clips.length;
  const graph =
    clips.map((_, i) => `[${i}:a]atrim=0:3,asetpts=N/SR/TB,aformat=sample_rates=24000:channel_layouts=mono[s${i}]`).join(';') +
    `;[${beep}:a]asplit=${clips.length}${clips.map((_, i) => `[b${i}]`).join('')};` +
    clips.map((_, i) => `[s${i}][b${i}]`).join('') +
    `concat=n=${clips.length * 2}:v=0:a=1[out]`;
  ff([...inputs, '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=0.6:sample_rate=24000,volume=0.3,aformat=channel_layouts=mono', '-filter_complex', graph, '-map', '[out]', path.join(OUT, 'split-check.wav')]);
  return clips;
}

function main() {
  const cap = JSON.parse(fs.readFileSync(path.join(OUT, 'capture.json'), 'utf8'));
  const paragraphs = readNarration(NAME);
  if (paragraphs.length !== cap.scenes.length) throw new Error(`narration has ${paragraphs.length} paragraphs but the capture has ${cap.scenes.length} scenes — re-run capture`);
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  /* voice clips → normalised wav + exact duration */
  let clips = paragraphs.map((p) => findClip(p.id));
  const full = AUDIO_EXT.map((e) => path.join(AUDIO_DIR, `full.${e}`)).find((f) => fs.existsSync(f));
  // full.* covers every paragraph that has no clip of its own (e.g. a TTS run that stopped
  // early, topped up with 11.wav, 12.wav)
  if (full && clips.some((c) => !c)) {
    const need = paragraphs.filter((_, i) => !clips[i]);
    const parts = splitFull(full, need);
    need.forEach((p, k) => (clips[paragraphs.indexOf(p)] = parts[k]));
  }
  const missing = paragraphs.filter((_, i) => !clips[i]).map((p) => p.id);
  const draft = missing.length === paragraphs.length;
  if (missing.length && !draft) throw new Error(`missing voice clips in audio/${NAME}/: ${missing.map((m) => `${m}.mp3`).join(', ')}`);

  const voice = paragraphs.map((p, i) => {
    if (draft) return { file: null, dur: estimateSeconds(p.text) };
    const wav = path.join(TMP, `voice-${p.id}.wav`);
    ff(['-i', clips[i], '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', wav]);
    return { file: wav, dur: probeDuration(wav) };
  });

  /* one encode per scene: frames → fitted H.264 */
  const frames = cap.frames;
  const parts = [];
  const report = [];
  let timeline = 0;
  for (let i = 0; i < cap.scenes.length; i++) {
    const s = cap.scenes[i];
    // frames that belong to this scene; start from the one on screen when it began
    let a = frames.findIndex((f) => f.ts >= s.start);
    if (a > 0 && frames[a].ts > s.start) a -= 1;
    let b = frames.findIndex((f) => f.ts >= s.end);
    if (b === -1) b = frames.length;
    const list = frames.slice(a, Math.max(b, a + 1));
    const lines = ['ffconcat version 1.0'];
    list.forEach((f, j) => {
      const from = Math.max(f.ts, s.start);
      const to = j + 1 < list.length ? list[j + 1].ts : s.end;
      lines.push(`file 'frames/${f.file}'`, `duration ${Math.max(0.001, (to - from) / 1000).toFixed(3)}`);
    });
    lines.push(`file 'frames/${list.at(-1).file}'`);
    const listFile = path.join(OUT, `scene-${String(i + 1).padStart(2, '0')}.txt`);
    fs.writeFileSync(listFile, lines.join('\n'));

    const natural = (s.end - s.start) / 1000;
    const target = snap(LEAD + voice[i].dur + TAIL);
    const factor = target / natural;
    const stretch = Math.min(factor, MAX_STRETCH);
    const hold = Math.max(0, target - natural * stretch);
    const fades = [];
    if (i === 0) fades.push('fade=t=in:st=0:d=0.5');
    if (i === cap.scenes.length - 1) fades.push(`fade=t=out:st=${(target - 0.8).toFixed(3)}:d=0.8`);
    const vf = [`setpts=${stretch.toFixed(5)}*(PTS-STARTPTS)`, `fps=${FPS}`, hold > 0 ? `tpad=stop_mode=clone:stop_duration=${(hold + 0.2).toFixed(3)}` : null, ...fades, 'format=yuv420p']
      .filter(Boolean)
      .join(',');
    const part = path.join(TMP, `part-${String(i + 1).padStart(2, '0')}.mp4`);
    ff(['-f', 'concat', '-safe', '0', '-i', path.basename(listFile), '-vf', vf, '-t', target.toFixed(3), '-r', String(FPS), '-c:v', 'libx264', '-crf', '16', '-preset', 'medium', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', part], { cwd: OUT });
    parts.push(part);
    report.push(
      `  [${paragraphs[i].id}] ${fmt(timeline)}  voice ${voice[i].dur.toFixed(1)}s  footage ${natural.toFixed(1)}s  → ${target.toFixed(1)}s  (${factor < 1 ? `faster ×${(1 / factor).toFixed(2)}` : `slower ×${stretch.toFixed(2)}${hold > 0.05 ? ` + hold ${hold.toFixed(1)}s` : ''}`})`,
    );
    voice[i].start = timeline;
    timeline += target;
    voice[i].target = target;
  }

  /* join scenes (same encoder settings → stream copy) */
  const concatList = path.join(TMP, 'parts.txt');
  fs.writeFileSync(concatList, parts.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
  const videoOnly = path.join(TMP, 'video.mp4');
  ff(['-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', videoOnly]);

  const outFile = path.join(OUT, draft ? `${NAME}-draft.mp4` : `${NAME}.mp4`);
  if (draft) {
    ff(['-i', videoOnly, '-c', 'copy', '-movflags', '+faststart', outFile]);
  } else {
    /* voice track: each clip delayed by LEAD and padded to exactly its scene length */
    const inputs = voice.flatMap((v) => ['-i', v.file]);
    const chains = voice.map((v, i) => `[${i}:a]adelay=${Math.round(LEAD * 1000)}:all=1,apad=whole_dur=${v.target.toFixed(3)},atrim=0:${v.target.toFixed(3)}[a${i}]`);
    const graph = `${chains.join(';')};${voice.map((_, i) => `[a${i}]`).join('')}concat=n=${voice.length}:v=0:a=1,loudnorm=I=-16:TP=-1.5:LRA=11[out]`;
    const audio = path.join(TMP, 'voice.m4a');
    ff([...inputs, '-filter_complex', graph, '-map', '[out]', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', audio]);
    ff(['-i', videoOnly, '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', outFile]);
  }

  const dur = probeDuration(outFile);
  console.log(report.join('\n'));
  console.log(`\n✔ ${path.relative(HERE, outFile)} · ${fmt(dur)} · ${(fs.statSync(outFile).size / 1048576).toFixed(1)} MB${draft ? ' · silent draft (no voice clips yet)' : ` · drift ${(dur - timeline).toFixed(2)}s`}`);
  fs.writeFileSync(path.join(OUT, 'timeline.json'), JSON.stringify(voice.map((v, i) => ({ id: paragraphs[i].id, title: cap.scenes[i].title, start: v.start, duration: v.target })), null, 1));
  fs.rmSync(TMP, { recursive: true, force: true });
}

function fmt(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

main();
