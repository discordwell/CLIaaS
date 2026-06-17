import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/password';

describe('password hashing', () => {
  it('verifies a correct password against its hash', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });

  it('fails closed (returns false, does not throw) on a malformed stored hash', async () => {
    // A stored hash whose key segment decodes to the wrong byte length used to throw
    // RangeError from timingSafeEqual on the login path. It must return false instead.
    await expect(verifyPassword('pw', 'deadbeef:abcd')).resolves.toBe(false);
  });

  it('returns false for a hash missing the salt/key separator', async () => {
    expect(await verifyPassword('pw', 'no-separator-here')).toBe(false);
  });

  it('returns false for an empty key segment', async () => {
    expect(await verifyPassword('pw', 'somesalt:')).toBe(false);
  });
});
