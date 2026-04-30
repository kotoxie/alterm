/**
 * Patches @marsaud/smb2's session setup messages to use NTLMv2 instead of
 * NTLMv1.  Must be called once before any SMB connection is made.
 *
 * The library ships with the `ntlm` npm package (v0.1.3, 2012) which only
 * implements NTLMv1 (DES-ECB challenge-response).  Modern Windows rejects
 * NTLMv1 by default ("Send NTLMv2 response only" policy), returning
 * STATUS_INVALID_PARAMETER during session setup.
 *
 * We monkey-patch the CJS module cache so smb2-forge.js sees our replacement
 * generate/onSuccess functions when it requires the session_setup_step* files.
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
  const step1 = _require('@marsaud/smb2/lib/messages/session_setup_step1') as Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const step2 = _require('@marsaud/smb2/lib/messages/session_setup_step2') as Record<string, any>;

  // ── Step 1: send NTLMv2 Negotiate (Type 1) ──────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  step1.generate = function (connection: Record<string, any>) {
    return new SMB2Message({
      headers: { Command: 'SESSION_SETUP', ProcessId: connection.ProcessId },
      request: { Buffer: encodeNegotiate(connection.ip ?? '', connection.domain ?? '') },
    });
  };

  // ── Step 1: capture full Type 2 challenge (incl. TargetInfo for blob) ───
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

  // ── Step 2: send NTLMv2 Authenticate (Type 3) ───────────────────────────
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
