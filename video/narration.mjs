// Narration files: narration/<name>.txt — one paragraph per scene, paragraphs separated
// by a blank line, each starting with its number in brackets: [01], [02], …
// The number is also the audio file name the voice clip must have (01.mp3, 02.mp3, …).
// Lines starting with # are notes for the reader and are ignored.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function readNarration(name) {
  const file = path.join(HERE, 'narration', `${name}.txt`);
  const raw = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').replace(/\r/g, '');
  const body = raw
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p, i) => {
      const m = p.match(/^\[(\d+)\]\s*/);
      if (!m || Number(m[1]) !== i + 1) throw new Error(`${name}.txt: paragraph ${i + 1} must start with [${String(i + 1).padStart(2, '0')}]`);
      return { n: i + 1, id: String(i + 1).padStart(2, '0'), text: p.slice(m[0].length).replace(/\s+/g, ' ').trim() };
    });
  return paragraphs;
}

/** Rough spoken length of a Persian paragraph (TTS reads about 2.4 words a second). */
export function estimateSeconds(text) {
  const words = text.split(/\s+/).filter(Boolean).length;
  return words / 2.4 + 0.8;
}
