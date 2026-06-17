import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${buf.toString('hex')}`;
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  const [salt, key] = hash.split(':');
  if (!salt || !key) return false;
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  const keyBuf = Buffer.from(key, 'hex');
  // A malformed or legacy stored hash can decode to a different byte length, and
  // timingSafeEqual throws RangeError unless both buffers are the same length. Fail
  // closed instead of throwing on the login path. The length is fixed by the KDF and
  // is not secret-dependent, so this early return leaks nothing useful to an attacker.
  if (keyBuf.length !== buf.length) return false;
  return timingSafeEqual(buf, keyBuf);
}
