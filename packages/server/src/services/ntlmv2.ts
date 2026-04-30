/**
 * NTLMv2 authentication implementation.
 * Replaces the @marsaud/smb2 bundled `ntlm` package (which only implements
 * NTLMv1) so that connections to modern Windows hosts succeed.
 *
 * References:
 *   MS-NLMP: https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-nlmp
 */
import crypto from 'node:crypto';

// ─── NTLM flags ─────────────────────────────────────────────────────────────
const F_UNICODE = 0x00000001; // NTLMSSP_NEGOTIATE_UNICODE
const F_TARGET  = 0x00000004; // NTLMSSP_REQUEST_TARGET
const F_NTLM    = 0x00000200; // NTLMSSP_NEGOTIATE_NTLM
const F_SIGN    = 0x00008000; // NTLMSSP_NEGOTIATE_ALWAYS_SIGN
const F_ESS     = 0x00080000; // NTLMSSP_NEGOTIATE_EXTENDED_SESSIONSECURITY
const F_128     = 0x20000000; // NTLMSSP_NEGOTIATE_128

const NEGOTIATE_FLAGS = F_UNICODE | F_TARGET | F_NTLM | F_SIGN | F_ESS | F_128;
const AUTH_FLAGS      = F_UNICODE | F_TARGET | F_NTLM | F_SIGN | F_ESS | F_128;

const SIG = Buffer.from('4e544c4d5353500000000000', 'hex'); // "NTLMSSP\0"

// ─── Type 1: NTLM Negotiate ──────────────────────────────────────────────────
export function encodeNegotiate(hostname: string, domain: string): Buffer {
  const hostBuf = Buffer.from(hostname.toUpperCase(), 'utf8');
  const domBuf  = Buffer.from(domain.toUpperCase(),  'utf8');

  // Fixed header: 32 bytes.  Payload: workstation then domain.
  const wsOffset  = 32;
  const domOffset = wsOffset + hostBuf.length;
  const buf = Buffer.alloc(domOffset + domBuf.length, 0);

  SIG.copy(buf, 0);
  buf.writeUInt32LE(0x01, 8);            // MessageType = 1
  buf.writeUInt32LE(NEGOTIATE_FLAGS, 12); // NegotiateFlags

  // DomainNameFields (Len, MaxLen, Offset)
  buf.writeUInt16LE(domBuf.length, 16);
  buf.writeUInt16LE(domBuf.length, 18);
  buf.writeUInt32LE(domOffset, 20);

  // WorkstationFields
  buf.writeUInt16LE(hostBuf.length, 24);
  buf.writeUInt16LE(hostBuf.length, 26);
  buf.writeUInt32LE(wsOffset, 28);

  hostBuf.copy(buf, wsOffset);
  domBuf.copy(buf, domOffset);
  return buf;
}

// ─── Type 2: NTLM Challenge (decode) ─────────────────────────────────────────
export interface NtlmChallenge {
  serverChallenge: Buffer; // 8 bytes
  targetInfo: Buffer;      // AvPairs
  flags: number;
}

export function decodeChallenge(buf: Buffer): NtlmChallenge {
  if (buf.length < 32) throw new Error('NTLM Type 2: buffer too short');
  if (buf.toString('binary', 0, 8) !== 'NTLMSSP\0') throw new Error('NTLM Type 2: bad signature');
  if (buf.readUInt32LE(8) !== 2) throw new Error('NTLM Type 2: wrong message type');

  const flags           = buf.readUInt32LE(20);
  const serverChallenge = Buffer.from(buf.slice(24, 32));

  let targetInfo = Buffer.alloc(0);
  // TargetInfoFields at offset 40
  if (buf.length >= 48) {
    const tiLen    = buf.readUInt16LE(40);
    const tiOffset = buf.readUInt32LE(44);
    if (tiLen > 0 && tiOffset >= 0 && tiOffset + tiLen <= buf.length) {
      targetInfo = Buffer.from(buf.slice(tiOffset, tiOffset + tiLen));
    }
  }
  return { serverChallenge, targetInfo, flags };
}

// ─── Crypto helpers ──────────────────────────────────────────────────────────
function md4(data: Buffer): Buffer {
  return crypto.createHash('md4').update(data).digest();
}
function hmacMd5(key: Buffer, data: Buffer): Buffer {
  return crypto.createHmac('md5', key).update(data).digest();
}

// ─── Type 3: NTLMv2 Authenticate ─────────────────────────────────────────────
export function encodeAuthenticate(
  username: string,
  domain: string,
  workstation: string,
  password: string,
  ch: NtlmChallenge,
): Buffer {
  // NT hash = MD4(UTF-16LE password)
  const ntHash   = md4(Buffer.from(password, 'utf16le'));
  // NTLMv2 hash = HMAC-MD5(NT, UPPER(user)+UPPER(domain) as UTF-16LE)
  const identity = Buffer.from((username.toUpperCase() + domain.toUpperCase()), 'utf16le');
  const v2Hash   = hmacMd5(ntHash, identity);

  // Client challenge (8 random bytes)
  const cc = crypto.randomBytes(8);

  // Windows FILETIME: 100-ns intervals since 1601-01-01
  const ts = Buffer.alloc(8);
  ts.writeBigUInt64LE(BigInt(Date.now()) * 10000n + 116444736000000000n);

  // NTLMv2 blob (temp)
  const blob = Buffer.concat([
    Buffer.from([0x01, 0x01, 0x00, 0x00]), // RespType, HiRespType, Reserved1
    Buffer.alloc(4, 0),                     // Reserved2
    ts,                                     // TimeStamp
    cc,                                     // ClientChallenge
    Buffer.alloc(4, 0),                     // Reserved3
    ch.targetInfo,                          // AvPairs from server
  ]);

  // NT proof and responses
  const ntProof    = hmacMd5(v2Hash, Buffer.concat([ch.serverChallenge, blob]));
  const ntResponse = Buffer.concat([ntProof, blob]);
  const lmResponse = Buffer.concat([
    hmacMd5(v2Hash, Buffer.concat([ch.serverChallenge, cc])),
    cc,
  ]);

  // Encode strings as UTF-16LE
  const userBuf = Buffer.from(username, 'utf16le');
  const domBuf  = Buffer.from(domain,   'utf16le');
  const wsBuf   = Buffer.from(workstation.toUpperCase(), 'utf16le');

  // Fixed header: 64 bytes (8 sig + 4 type + 8*5 fields + 8 session key field + 4 flags)
  const HEADER = 64;
  const lmOff  = HEADER;
  const ntOff  = lmOff + lmResponse.length;
  const domOff = ntOff + ntResponse.length;
  const usrOff = domOff + domBuf.length;
  const wsOff  = usrOff + userBuf.length;
  const total  = wsOff  + wsBuf.length;

  const msg = Buffer.alloc(total, 0);
  let p = 0;

  SIG.copy(msg, p); p += 8;
  msg.writeUInt32LE(0x03, p); p += 4; // MessageType = 3

  // LmChallengeResponseFields
  msg.writeUInt16LE(lmResponse.length, p); p += 2;
  msg.writeUInt16LE(lmResponse.length, p); p += 2;
  msg.writeUInt32LE(lmOff, p); p += 4;

  // NtChallengeResponseFields
  msg.writeUInt16LE(ntResponse.length, p); p += 2;
  msg.writeUInt16LE(ntResponse.length, p); p += 2;
  msg.writeUInt32LE(ntOff, p); p += 4;

  // DomainNameFields
  msg.writeUInt16LE(domBuf.length, p); p += 2;
  msg.writeUInt16LE(domBuf.length, p); p += 2;
  msg.writeUInt32LE(domOff, p); p += 4;

  // UserNameFields
  msg.writeUInt16LE(userBuf.length, p); p += 2;
  msg.writeUInt16LE(userBuf.length, p); p += 2;
  msg.writeUInt32LE(usrOff, p); p += 4;

  // WorkstationFields
  msg.writeUInt16LE(wsBuf.length, p); p += 2;
  msg.writeUInt16LE(wsBuf.length, p); p += 2;
  msg.writeUInt32LE(wsOff, p); p += 4;

  // EncryptedRandomSessionKeyFields (empty — no key exchange)
  p += 8; // already zeroed

  // NegotiateFlags
  msg.writeUInt32LE(AUTH_FLAGS, p); // p += 4 (no more fields)

  // Payload
  lmResponse.copy(msg, lmOff);
  ntResponse.copy(msg, ntOff);
  domBuf.copy(msg,  domOff);
  userBuf.copy(msg, usrOff);
  wsBuf.copy(msg,   wsOff);

  return msg;
}
