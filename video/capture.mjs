// Captures one walkthrough video as lossless PNG frames, split into scenes — one scene per
// narration paragraph — so assemble.mjs can fit every scene to its own voice clip.
//
//   node capture.mjs roadmap          (or waiter | kitchen | bar | cashier | manager)
//
// It starts its own RMS server on a throwaway database (video/.data), seeds the Persian
// demo data, logs every role in through a separate browser context (separate cookies),
// and runs scenes/<name>.mjs. Nothing touches the real database in server/data.
//
// Output: out/<name>/frames/*.png + out/<name>/capture.json (per-frame timestamps and
// scene boundaries).

import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { readNarration, estimateSeconds } from './narration.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const NAME = process.argv[2];
if (!NAME) {
  console.error('usage: node capture.mjs <roadmap|waiter|kitchen|bar|cashier|manager>');
  process.exit(1);
}

const PORT = Number(process.env.VIDEO_PORT || 4100);
const BASE = `http://127.0.0.1:${PORT}`;
// 1600x900 CSS pixels rendered at 1.2x = exactly 1920x1080 device pixels: text is
// rasterised at the final resolution, never resampled.
const W = 1600;
const H = 900;
const DSF = 1.2;

const OUT = path.join(HERE, 'out', NAME);
const DATA = path.join(HERE, '.data');
const DB_FILE = path.join(DATA, 'video.sqlite');

const USERS = {
  manager: { username: 'manager', password: 'manager123' },
  waiter: { username: 'ali', password: 'waiter123' },
  waiter2: { username: 'maryam', password: 'waiter123' },
  kitchen: { username: 'sara', password: 'kitchen123' },
  bar: { username: 'omid', password: 'bar12345' },
  cashier: { username: 'neda', password: 'cashier123' },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ─────────────── server on a throwaway database ─────────────── */

function serverEnv() {
  return { ...process.env, DB_FILE, PORT: String(PORT), HOST: '127.0.0.1', COOKIE_SECURE: 'false', NODE_ENV: 'development' };
}

function resetDatabase() {
  fs.mkdirSync(DATA, { recursive: true });
  execFileSync(process.execPath, ['--no-warnings=ExperimentalWarning', 'src/db/seed.js', '--reset', '--history'], {
    cwd: path.join(ROOT, 'server'),
    env: serverEnv(),
    stdio: 'inherit',
  });
}

async function startServer() {
  const child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', 'src/index.js'], {
    cwd: path.join(ROOT, 'server'),
    env: serverEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return child;
    } catch {
      /* not up yet */
    }
    if (child.exitCode !== null) break;
    await sleep(150);
  }
  child.kill();
  throw new Error(`video server did not start:\n${log}`);
}

/* ─────────────── in-page overlays: cursor + caption ─────────────── */

// Headless Chromium paints no cursor. The caption (lower third) is read back from
// sessionStorage on every load so it survives full navigations.
const OVERLAY = `(() => {
  const css = \`
    #__cur{position:fixed;z-index:2147483647;width:22px;height:22px;left:-40px;top:-40px;pointer-events:none;border-radius:50%;
      background:radial-gradient(circle at 32% 30%,#fff,#ff8a3d);box-shadow:0 0 0 4px rgba(255,138,61,.35),0 2px 10px rgba(0,0,0,.45);transition:transform .08s}
    #__cur.down{transform:scale(.65);box-shadow:0 0 0 12px rgba(255,138,61,.25),0 2px 10px rgba(0,0,0,.45)}
    #__cap{position:fixed;z-index:2147483646;left:50%;top:11px;transform:translateX(-50%);display:flex;justify-content:center;pointer-events:none;
      font-family:Vazirmatn,system-ui,sans-serif;direction:rtl;white-space:nowrap}
    #__cap>div{display:flex;align-items:center;gap:10px;background:#fff;color:#1c1917;border-radius:999px;border:2px solid #ff8a3d;
      padding:4px 18px 4px 6px;font-size:18px;font-weight:700;box-shadow:0 6px 22px rgba(0,0,0,.35)}
    #__cap .role{background:#c2410c;color:#fff;border-radius:999px;padding:2px 12px;font-size:15px;font-weight:800}
    #__cap.bottom{top:auto;bottom:20px}
    #__cap.corner{top:auto;bottom:20px;left:20px;transform:none}
    #__cap:empty{display:none}\`;
  const mount = () => {
    if (document.getElementById('__cur')) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const c = document.createElement('div'); c.id = '__cur'; document.body.appendChild(c);
    const cap = document.createElement('div'); cap.id = '__cap'; document.body.appendChild(cap);
    window.__setCaption = (role, text, pos) => {
      cap.className = pos || '';
      cap.innerHTML = '';
      if (!text) return;
      const box = document.createElement('div');
      if (role) { const r = document.createElement('span'); r.className = 'role'; r.textContent = role; box.appendChild(r); }
      const t = document.createElement('span'); t.textContent = text; box.appendChild(t);
      cap.appendChild(box);
    };
    try { const s = JSON.parse(sessionStorage.getItem('__cap') || 'null'); if (s) window.__setCaption(s.role, s.text, s.pos); } catch {}
    const last = JSON.parse(sessionStorage.getItem('__curpos') || 'null');
    if (last) { c.style.left = (last[0]-11)+'px'; c.style.top = (last[1]-11)+'px'; }
  };
  document.readyState === 'loading' ? addEventListener('DOMContentLoaded', mount) : mount();
  addEventListener('mousemove', e => { const c = document.getElementById('__cur'); if (!c) return;
    c.style.left = (e.clientX-11)+'px'; c.style.top = (e.clientY-11)+'px';
    try { sessionStorage.setItem('__curpos', JSON.stringify([e.clientX, e.clientY])); } catch {} }, true);
  addEventListener('mousedown', () => document.getElementById('__cur')?.classList.add('down'), true);
  addEventListener('mouseup', () => document.getElementById('__cur')?.classList.remove('down'), true);
})();`;

/* ─────────────── main ─────────────── */

async function main() {
  const scenesModule = await import(pathToFileURL(path.join(HERE, 'scenes', `${NAME}.mjs`)).href);
  const paragraphs = readNarration(NAME);
  const scenes = scenesModule.scenes;
  if (scenes.length !== paragraphs.length) {
    throw new Error(`${NAME}: ${scenes.length} scenes but ${paragraphs.length} narration paragraphs — they must match 1:1`);
  }

  resetDatabase();
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  try {
    await record(browser, scenesModule, scenes, paragraphs);
  } finally {
    await browser.close().catch(() => {});
    server.kill();
  }
}

async function record(browser, scenesModule, scenes, paragraphs) {
  const framesDir = path.join(OUT, 'frames');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });

  /* one browser context per role = one cookie jar per role */
  const roles = {};
  /** A browser context per role. `noLogin` leaves it signed out, to film the login screen. */
  async function role(key, { noLogin = false } = {}) {
    if (roles[key]) return roles[key];
    const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF, locale: 'fa-IR', timezoneId: 'Asia/Tehran' });
    await context.addInitScript(OVERLAY);
    const u = USERS[key];
    if (!noLogin) {
      const res = await context.request.post(`${BASE}/api/auth/login`, { data: u, headers: { origin: BASE } });
      if (!res.ok()) throw new Error(`login ${key} failed: ${res.status()} ${await res.text()}`);
    }
    const page = await context.newPage();
    const api = {
      async call(method, url, data) {
        const r = await context.request.fetch(`${BASE}/api${url}`, { method, data, headers: { origin: BASE } });
        const body = await r.json().catch(() => null);
        if (!r.ok()) throw new Error(`${key} ${method} ${url} → ${r.status()} ${JSON.stringify(body)}`);
        return body;
      },
      get: (url) => api.call('GET', url),
      post: (url, data = {}) => api.call('POST', url, data),
      patch: (url, data = {}) => api.call('PATCH', url, data),
    };
    roles[key] = { key, context, page, api, mouse: [W / 2, H / 2] };
    return roles[key];
  }

  let current = null; // the role whose page is on camera
  let navigating = false; // a full page load is in progress on camera: hold the last frame
  const frames = [];
  let capturing = true;
  let t0 = null;

  const pump = (async () => {
    let i = 0;
    while (capturing) {
      if (!current || t0 === null || navigating) {
        await sleep(20);
        continue;
      }
      const ts = Date.now() - t0;
      try {
        const buf = await current.page.screenshot({ type: 'png', animations: 'allow', scale: 'device', caret: 'initial', timeout: 2000 });
        const file = `f${String(i++).padStart(6, '0')}.png`;
        fs.writeFileSync(path.join(framesDir, file), buf);
        frames.push({ file, ts });
      } catch {
        /* page mid-navigation: skip this frame */
      }
    }
  })();

  /* diagram slides: a plain page, no login, font inlined so it renders offline */
  let slides = null;
  async function slidesPage() {
    if (slides) return slides;
    const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF });
    const page = await context.newPage();
    const font = fs.readFileSync(path.join(ROOT, 'client', 'node_modules', 'vazirmatn', 'fonts', 'webfonts', 'Vazirmatn[wght].woff2')).toString('base64');
    const html = fs
      .readFileSync(path.join(HERE, 'slides.html'), 'utf8')
      .replace('/*FONT*/', `@font-face{font-family:Vazirmatn;src:url(data:font/woff2;base64,${font}) format('woff2');font-weight:100 900;font-display:block}`);
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    slides = { key: 'slides', context, page, api: null, mouse: [W / 2, H / 2] };
    return slides;
  }

  /* direct SQL on the video database, for things the API rightly refuses (e.g. backdating a ticket) */
  let db = null;
  const sql = (text, ...params) => {
    if (!db) {
      db = new DatabaseSync(DB_FILE);
      db.exec('PRAGMA busy_timeout = 5000');
    }
    return db.prepare(text).run(...params);
  };

  /* ─── helpers handed to the scene scripts ─── */
  const ctx = {
    sql,
    USERS,
    /** Put the diagram page on camera and run one of its show* functions (awaits its animation). */
    async slide(fn, ...args) {
      const s = await slidesPage();
      current = s;
      await s.page.bringToFront();
      await s.page.evaluate(({ fn, args }) => window[fn](...args), { fn, args });
    },
    BASE,
    W,
    H,
    sleep,
    role,
    /** Put a role's screen on camera (logs it in on first use); caption = [roleLabel, text]. */
    async show(key, { url, caption } = {}) {
      const r = await role(key);
      if (url) await ctx.go(url, r);
      if (caption) await ctx.caption(...caption, r);
      current = r;
      await r.page.bringToFront();
      return r;
    },
    get page() {
      return current.page;
    },
    get who() {
      return current;
    },
    async go(url, r = current) {
      const onCamera = r === current;
      if (onCamera) navigating = true;
      try {
        await r.page.goto(`${BASE}${url}`, { waitUntil: 'load', timeout: 15_000 });
        await r.page.evaluate(() => document.fonts.ready);
        await sleep(700); // let the SPA fetch and render
      } finally {
        if (onCamera) navigating = false;
      }
    },
    /** Lower-third caption on the current page (and it sticks across navigations). */
    async caption(roleLabel, text, pos = '', r = current) {
      if (typeof pos === 'object') [r, pos] = [pos, ''];
      const p = r.page;
      await p.evaluate(
        ({ roleLabel, text, pos }) => {
          sessionStorage.setItem('__cap', JSON.stringify({ role: roleLabel, text, pos }));
          window.__setCaption?.(roleLabel, text, pos);
        },
        { roleLabel, text, pos },
      );
    },
    async moveTo(x, y, steps = 28) {
      x = clamp(x, 2, W - 2);
      y = clamp(y, 2, H - 2);
      await current.page.mouse.move(x, y, { steps });
      current.mouse = [x, y];
    },
    /** Glide the cursor onto an element (a Playwright locator or selector). */
    async point(target, { steps = 28, dx = 0.5, dy = 0.5 } = {}) {
      const loc = typeof target === 'string' ? current.page.locator(target).first() : target;
      await loc.waitFor({ state: 'visible', timeout: 10_000 });
      await loc.scrollIntoViewIfNeeded();
      const box = await loc.boundingBox();
      await ctx.moveTo(box.x + box.width * dx, box.y + box.height * dy, steps);
      return loc;
    },
    async click(target, opts = {}) {
      const loc = await ctx.point(target, opts);
      await sleep(opts.pause ?? 350);
      // A real press at the pointer position, so the on-screen cursor visibly clicks.
      await current.page.mouse.down();
      await sleep(90);
      await current.page.mouse.up();
      await sleep(opts.after ?? 500);
      return loc;
    },
    async type(target, text, { delay = 70, clear = false } = {}) {
      const loc = await ctx.click(target, { after: 200 });
      if (clear) await loc.fill('');
      await loc.pressSequentially(text, { delay });
      await sleep(300);
      return loc;
    },
    /** Hover over an element for a while so viewers can read it. */
    async look(target, ms = 1500, opts = {}) {
      await ctx.point(target, opts);
      await sleep(ms);
    },
    async wheel(dy, over) {
      if (over) await ctx.point(over);
      for (let i = 0; i < 8; i++) {
        await current.page.mouse.wheel(0, dy / 8);
        await sleep(45);
      }
      await sleep(400);
    },
    text: (t, sel = '*') => current.page.locator(sel).filter({ hasText: t }),
    btn: (t) => current.page.getByRole('button', { name: t }).first(),
  };

  if (scenesModule.setup) await scenesModule.setup(ctx);

  const sceneMarks = [];
  t0 = Date.now();
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const target = estimateSeconds(paragraphs[i].text) * 1000;
    const start = Date.now() - t0;
    process.stdout.write(`  [${String(i + 1).padStart(2, '0')}] ${s.title} … `);
    await s.run(ctx);
    // Hold on the last state until the scene is as long as its paragraph will likely be
    // spoken, so the assemble step only nudges the timing instead of racing through it.
    const spent = Date.now() - t0 - start;
    if (spent < target) await sleep(target - spent);
    const end = Date.now() - t0;
    sceneMarks.push({ n: i + 1, title: s.title, start, end });
    console.log(`${((end - start) / 1000).toFixed(1)}s (spoken ≈ ${(target / 1000).toFixed(1)}s)`);
  }
  await sleep(300);

  capturing = false;
  await pump;
  db?.close();

  if (!frames.length) throw new Error('no frames captured');
  fs.writeFileSync(path.join(OUT, 'capture.json'), JSON.stringify({ name: NAME, width: W * DSF, height: H * DSF, frames, scenes: sceneMarks }, null, 1));
  const total = frames[frames.length - 1].ts / 1000;
  console.log(`\n✔ ${NAME}: ${frames.length} frames · ${total.toFixed(1)}s · ~${(frames.length / total).toFixed(1)} fps`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
