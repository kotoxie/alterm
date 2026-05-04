/**
 * Patches @marsaud/smb2 to fix two known incompatibilities with modern Windows:
 *
 * 1. NTLMv2 authentication — the library ships with the `ntlm` package (v0.1.3,
 *    2012) which only implements NTLMv1. Modern Windows rejects NTLMv1 by default
 *    ("Send NTLMv2 response only" policy), returning STATUS_INVALID_PARAMETER
 *    during session setup.
 *
 * 2. SMB2 async interim responses — Windows Server 2022 always responds to READ
 *    requests with a STATUS_PENDING (0x103) interim frame before the final
 *    STATUS_SUCCESS frame. The library has no async handling: it dispatches the
 *    callback immediately on the interim frame (treating it as an error) and
 *    discards the real response. We patch smb2-forge.js to silently skip
 *    STATUS_PENDING frames so the callback fires on the real response instead.
 *
 * Both patches replace entries in the CJS module cache — no library changes needed.
 */
import { createRequire } from 'node:module';
import { encodeNegotiate, decodeChallenge, encodeAuthenticate, type NtlmChallenge } from './ntlmv2.js';

const _require = createRequire(import.meta.url);

let patched = false;

export function patchSmbNtlm(): void {
  if (patched) return;
  patched = true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SMB2Message = _require('@marsaud/smb2/lib/tools/smb2-message') as new (opts: any) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SMB2Forge = _require('@marsaud/smb2/lib/tools/smb2-forge') as Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const step1 = _require('@marsaud/smb2/lib/messages/session_setup_step1') as Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const step2 = _require('@marsaud/smb2/lib/messages/session_setup_step2') as Record<string, any>;

  // ── Patch 1: skip STATUS_PENDING async interim responses ─────────────────
  // Windows Server 2022 always replies to READ with an interim STATUS_PENDING
  // frame before the real STATUS_SUCCESS frame. Both frames share the same
  // MessageId, so leaving the callback registered lets it fire on the real one.
  const STATUS_PENDING = 0x00000103;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  SMB2Forge.response = function (c: any) {
    c.responses = {};
    c.responsesCB = {};
    c.responseBuffer = Buffer.allocUnsafe(0);
    return function (data: Buffer) {
      c.responseBuffer = Buffer.concat([c.responseBuffer, data]);
      let extract = true;
      while (extract) {
        extract = false;
        if (c.responseBuffer.length >= 4) {
          const msgLength = (c.responseBuffer.readUInt8(1) << 16) + c.responseBuffer.readUInt16BE(2);
          if (c.responseBuffer.length >= msgLength + 4) {
            extract = true;
            const r = c.responseBuffer.slice(4, msgLength + 4);
            c.responseBuffer = c.responseBuffer.slice(msgLength + 4);
            const message = new SMB2Message();
            message.parseBuffer(r);
            const h = message.getHeaders();
            // Skip interim async frame — keep callback registered for the real response
            if (h.Status === STATUS_PENDING) continue;
            const mId: string = h.MessageId.toString('hex');
            if (c.responsesCB[mId]) {
              c.responsesCB[mId](message);
              delete c.responsesCB[mId];
            } else {
              c.responses[mId] = message;
            }
          }
        }
      }
    };
  };

  // ── Patch 2: send NTLMv2 Negotiate (Type 1) ─────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  step1.generate = function (connection: Record<string, any>) {
    return new SMB2Message({
      headers: { Command: 'SESSION_SETUP', ProcessId: connection.ProcessId },
      request: { Buffer: encodeNegotiate(connection.ip ?? '', connection.domain ?? '') },
    });
  };

  // ── Patch 2 cont: capture full Type 2 challenge (incl. TargetInfo for blob) ─
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  step1.onSuccess = function (connection: Record<string, any>, response: any) {
    const h = response.getHeaders();
    connection.SessionId = h.SessionId;
    try {
      const ch = decodeChallenge(response.getResponse().Buffer as Buffer);
      connection.nonce          = ch.serverChallenge; // keep for backwards-compat
      connection.ntlmv2Challenge = ch;
    } catch {
      // Non-standard server — fall back to raw nonce
      const buf = response.getResponse().Buffer as Buffer;
      if (buf?.length >= 32) connection.nonce = buf.slice(24, 32);
    }
  };

  // ── Patch 2 cont: send NTLMv2 Authenticate (Type 3) ─────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  step2.generate = function (connection: Record<string, any>) {
    const ch: NtlmChallenge = connection.ntlmv2Challenge ?? {
      serverChallenge: connection.nonce ?? Buffer.alloc(8),
      targetInfo:      Buffer.alloc(0),
      flags:           0,
    };
    return new SMB2Message({
      headers: {
        Command:   'SESSION_SETUP',
        SessionId: connection.SessionId,
        ProcessId: connection.ProcessId,
      },
      request: {
        Buffer: encodeAuthenticate(
          connection.username   ?? '',
          connection.domain     ?? '',
          connection.ip         ?? '',
          connection.password   ?? '',
          ch,
        ),
      },
    });
  };
}
