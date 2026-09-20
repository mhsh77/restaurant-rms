import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

let db = null;
let statements = new Map();

/** Open (once) and return the process-wide SQLite connection. */
export function getDb() {
  if (db) return db;
  if (config.dbFile !== ':memory:') {
    fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
  }
  db = new DatabaseSync(config.dbFile);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;
  `);
  return db;
}

export function closeDb() {
  if (db) {
    statements = new Map();
    db.close();
    db = null;
  }
}

function prepared(sql) {
  let stmt = statements.get(sql);
  if (!stmt) {
    stmt = getDb().prepare(sql);
    statements.set(sql, stmt);
  }
  return stmt;
}

let txDepth = 0;

/**
 * Run fn inside a write transaction. BEGIN IMMEDIATE takes the write lock up front, so a
 * read-check-write sequence inside fn cannot interleave with another writer (including
 * another process on the same file). Nested calls join the outer transaction.
 */
export function transaction(fn) {
  const conn = getDb();
  if (txDepth > 0) return fn(conn);
  conn.exec('BEGIN IMMEDIATE');
  txDepth++;
  try {
    const result = fn(conn);
    conn.exec('COMMIT');
    return result;
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  } finally {
    txDepth--;
  }
}

/** Small helpers so services read like SQL rather than driver plumbing. */
export const q = {
  get: (sql, ...params) => prepared(sql).get(...params) ?? null,
  all: (sql, ...params) => prepared(sql).all(...params),
  run: (sql, ...params) => prepared(sql).run(...params),
};

export const nowIso = () => new Date().toISOString();
export const bool = (v) => (v ? 1 : 0);
