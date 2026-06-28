import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from '../../src/auth/crypto.js';

const KEY = Buffer.alloc(32, 9);

describe('crypto', () => {
  it('round-trips a value', () => {
    const secret = 'wiki-access-token-value';
    expect(decrypt(encrypt(secret, KEY), KEY)).toBe(secret);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const a = encrypt('same', KEY);
    const b = encrypt('same', KEY);
    expect(a).not.toBe(b);
    expect(decrypt(a, KEY)).toBe('same');
    expect(decrypt(b, KEY)).toBe('same');
  });

  it('throws when the payload is tampered with', () => {
    const payload = encrypt('tamper-me', KEY);
    const raw = Buffer.from(payload, 'base64');
    raw[raw.length - 1] ^= 0xff; // flip a ciphertext byte
    const tampered = raw.toString('base64');
    expect(() => decrypt(tampered, KEY)).toThrow();
  });

  it('throws when decrypting with the wrong key', () => {
    const payload = encrypt('secret', KEY);
    const wrong = Buffer.alloc(32, 1);
    expect(() => decrypt(payload, wrong)).toThrow();
  });
});
