import crypto from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 64;

/** Hash with scrypt. Format: scrypt$N$r$p$saltB64$hashB64 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

export function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

// A real hash of a random string, used to spend the same CPU time when a username
// does not exist, so response timing does not reveal valid usernames.
export const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));
