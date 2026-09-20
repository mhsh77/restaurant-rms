// Runs the API (with --watch) and the Vite dev server side by side. Ctrl+C stops both.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const procs = [
  ['api', path.join(root, 'server')],
  ['web', path.join(root, 'client')],
].map(([name, cwd]) => {
  const child = spawn(npm, ['run', 'dev'], { cwd, shell: process.platform === 'win32', stdio: ['inherit', 'pipe', 'pipe'] });
  const prefix = (chunk) => chunk.toString().split(/\r?\n/).filter(Boolean).map((l) => `[${name}] ${l}`).join('\n') + '\n';
  child.stdout.on('data', (c) => process.stdout.write(prefix(c)));
  child.stderr.on('data', (c) => process.stderr.write(prefix(c)));
  child.on('exit', (code) => {
    console.log(`[${name}] exited with code ${code}`);
    for (const p of procs) if (p !== child) p.kill();
    process.exit(code ?? 0);
  });
  return child;
});

process.on('SIGINT', () => procs.forEach((p) => p.kill()));
