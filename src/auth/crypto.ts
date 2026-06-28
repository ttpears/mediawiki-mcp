import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const IV_LENGTH = 12; // 96-bit nonce, recommended for GCM
const TAG_LENGTH = 16; // 128-bit auth tag

/**
 * Encrypts a UTF-8 string with AES-256-GCM.
 * Output layout: base64( iv[12] | tag[16] | ciphertext ).
 */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/**
 * Inverse of {@link encrypt}. Throws if the key is wrong or the payload was
 * tampered with (GCM auth tag verification failure).
 */
export function decrypt(payload: string, key: Buffer): string {
  const raw = Buffer.from(payload, 'base64');
  const iv = raw.subarray(0, IV_LENGTH);
  const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = raw.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
