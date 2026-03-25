import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { getEncryptionKeyHex } from './encryption.js';

const BACKUP_MAGIC = Buffer.from('ALTBAK');
const BACKUP_VERSION = 0x01;
const KDF_ITERATIONS = 200_000;
const KDF_KEYLEN = 32;

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, KDF_ITERATIONS, KDF_KEYLEN, 'sha256');
}

export function createBackup(password: string, dbBytes: Buffer): Buffer {
  const kdfSalt = crypto.randomBytes(32);
  const hmacSalt = crypto.randomBytes(32);
  const iv = crypto.randomBytes(16);
  const encKey = deriveKey(password, kdfSalt);
  const hmacKey = deriveKey(password, hmacSalt);

  const recordings: Array<{ name: string; size: number }> = [];
  const recBuffers: Buffer[] = [];
  if (fs.existsSync(config.recordingsDir)) {
    for (const fname of fs.readdirSync(config.recordingsDir)) {
      const fp = path.join(config.recordingsDir, fname);
      try {
        const stat = fs.statSync(fp);
        if (!stat.isFile()) continue;
        const buf = fs.readFileSync(fp);
        recordings.push({ name: fname, size: buf.length });
        recBuffers.push(buf);
      } catch { /* skip */ }
    }
  }

  const encryptionKeyHex = getEncryptionKeyHex();

  const manifest = Buffer.from(JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    dbSize: dbBytes.length,
    recordings,
    encryptionKeyHex,
  }), 'utf8');

  const manifestLen = Buffer.allocUnsafe(4);
  manifestLen.writeUInt32LE(manifest.length, 0);

  const plaintext = Buffer.concat([manifestLen, manifest, dbBytes, ...recBuffers]);
  const cipher = crypto.createCipheriv('aes-256-ctr', encKey, iv);
  const encBody = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  // header: magic(6) + version(1) + kdfSalt(32) + iv(16) + hmacSalt(32) = 87 bytes
  const header = Buffer.concat([BACKUP_MAGIC, Buffer.from([BACKUP_VERSION]), kdfSalt, iv, hmacSalt]);

  const hmac = crypto.createHmac('sha256', hmacKey);
  hmac.update(header);
  hmac.update(encBody);
  const mac = hmac.digest();

  return Buffer.concat([header, encBody, mac]);
}

export interface RestoreResult {
  dbBytes: Buffer;
  recordings: Array<{ name: string; data: Buffer }>;
  encryptionKeyHex: string;
}

export function restoreBackup(data: Buffer, password: string): RestoreResult {
  let offset = 0;
  const magic = data.subarray(offset, offset + BACKUP_MAGIC.length);
  if (!magic.equals(BACKUP_MAGIC)) throw new Error('Invalid backup file — not an Alterm backup');
  offset += BACKUP_MAGIC.length;

  const version = data[offset++];
  if (version !== BACKUP_VERSION) throw new Error(`Unsupported backup version: ${version}`);

  const kdfSalt = data.subarray(offset, offset + 32); offset += 32;
  const iv = data.subarray(offset, offset + 16); offset += 16;
  const hmacSalt = data.subarray(offset, offset + 32); offset += 32;
  const headerEnd = offset;

  const mac = data.subarray(data.length - 32);
  const encBody = data.subarray(headerEnd, data.length - 32);

  const encKey = deriveKey(password, kdfSalt);
  const hmacKey = deriveKey(password, hmacSalt);

  const hmac = crypto.createHmac('sha256', hmacKey);
  hmac.update(data.subarray(0, headerEnd));
  hmac.update(encBody);
  const expectedMac = hmac.digest();
  if (!crypto.timingSafeEqual(mac, expectedMac)) {
    throw new Error('Invalid backup password or corrupted backup file');
  }

  const decipher = crypto.createDecipheriv('aes-256-ctr', encKey, iv);
  const plaintext = Buffer.concat([decipher.update(encBody), decipher.final()]);

  let pos = 0;
  const manifestLen = plaintext.readUInt32LE(pos); pos += 4;
  const manifest = JSON.parse(plaintext.subarray(pos, pos + manifestLen).toString('utf8')) as {
    version: number;
    exportedAt: string;
    dbSize: number;
    recordings: Array<{ name: string; size: number }>;
    encryptionKeyHex: string;
  };
  pos += manifestLen;

  const dbBytes = plaintext.subarray(pos, pos + manifest.dbSize); pos += manifest.dbSize;

  const recordings: Array<{ name: string; data: Buffer }> = [];
  for (const rec of manifest.recordings) {
    recordings.push({ name: rec.name, data: Buffer.from(plaintext.subarray(pos, pos + rec.size)) });
    pos += rec.size;
  }

  return { dbBytes: Buffer.from(dbBytes), recordings, encryptionKeyHex: manifest.encryptionKeyHex };
}
