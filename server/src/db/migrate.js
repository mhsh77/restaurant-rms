import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, closeDb, nowIso } from './connection.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Apply every *.sql file in migrations/ that has not been applied yet, in name order.
 * A migration starting with "-- pragma: foreign_keys=off" runs with foreign keys disabled
 * (needed to rebuild a referenced table) and is verified with PRAGMA foreign_key_check.
 */
export function migrate({ log = console.log } = {}) {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const withoutForeignKeys = /^--\s*pragma:\s*foreign_keys=off/m.test(sql);
    if (withoutForeignKeys) db.exec('PRAGMA foreign_keys = OFF'); // must happen outside a transaction
    db.exec('BEGIN');
    try {
      db.exec(sql);
      if (withoutForeignKeys) {
        const broken = db.prepare('PRAGMA foreign_key_check').all();
        if (broken.length) throw new Error(`foreign key check failed: ${JSON.stringify(broken.slice(0, 5))}`);
      }
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(file, nowIso());
      db.exec('COMMIT');
      log(`migration applied: ${file}`);
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${file} failed: ${err.message}`);
    } finally {
      if (withoutForeignKeys) db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate();
  closeDb();
}
