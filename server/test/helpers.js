/**
 * Test harness: fresh SQLite file per test file, real HTTP server on a random port,
 * real Socket.IO connections, one cookie jar per user.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rms-test-'));
process.env.DB_FILE = path.join(dir, 'test.sqlite');
process.env.UPLOAD_DIR = path.join(dir, 'uploads');
process.env.JWT_SECRET = 'test-secret-please-ignore';
process.env.SEED_TIMEZONE = 'UTC';

const { seedDemo } = await import('../src/db/seed.js');
const { createApp } = await import('../src/app.js');
const { createSocketServer } = await import('../src/realtime/socket.js');
const { closeDb } = await import('../src/db/connection.js');
const { io: ioClient } = await import('socket.io-client');

export async function startServer() {
  seedDemo();
  const server = http.createServer(createApp());
  const io = createSocketServer(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const sockets = [];

  async function stop() {
    for (const s of sockets) s.close();
    io.close();
    await new Promise((r) => server.close(r));
    closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  /** A logged-in API client. */
  async function login(username, password) {
    const client = new Client(base, sockets);
    const res = await client.post('/api/auth/login', { username, password });
    if (res.status !== 200) throw new Error(`login ${username} failed: ${res.status} ${JSON.stringify(res.body)}`);
    client.session = res.body;
    return client;
  }

  return { base, stop, login, anonymous: () => new Client(base, sockets) };
}

class Client {
  constructor(base, sockets) {
    this.base = base;
    this.cookie = '';
    this.sockets = sockets;
  }

  async request(method, url, body) {
    const res = await fetch(this.base + url, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const text = await res.text();
    let parsed = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* CSV or empty */
    }
    return { status: res.status, body: parsed, headers: res.headers };
  }

  get(url) {
    return this.request('GET', url);
  }
  post(url, body = {}) {
    return this.request('POST', url, body);
  }
  put(url, body) {
    return this.request('PUT', url, body);
  }
  patch(url, body) {
    return this.request('PATCH', url, body);
  }
  del(url) {
    return this.request('DELETE', url);
  }

  /** Connect a socket that records every event it receives. */
  async connectSocket() {
    const socket = ioClient(this.base, { transports: ['websocket'], extraHeaders: { cookie: this.cookie }, reconnection: false, forceNew: true });
    this.sockets.push(socket);
    const events = [];
    socket.onAny((event, payload) => events.push({ event, payload }));
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return {
      socket,
      events,
      /** Wait until an event matching the predicate arrives (or has already arrived). */
      waitFor(event, predicate = () => true, timeoutMs = 2000) {
        const found = events.find((e) => e.event === event && predicate(e.payload));
        if (found) return Promise.resolve(found.payload);
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            socket.offAny(listener);
            reject(new Error(`timeout waiting for ${event}`));
          }, timeoutMs);
          const listener = (name, payload) => {
            if (name === event && predicate(payload)) {
              clearTimeout(timer);
              socket.offAny(listener);
              resolve(payload);
            }
          };
          socket.onAny(listener);
        });
      },
      clear() {
        events.length = 0;
      },
    };
  }
}
