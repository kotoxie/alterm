import type { IncomingMessage } from 'http';

/**
 * Resolve the real client IP for both HTTP and WebSocket requests.
 *
 * HTTP routes benefit from Express's trust-proxy middleware which sets req.ip
 * correctly. WebSocket upgrade requests arrive before Express can set req.ip,
 * so we must resolve the forwarded IP manually — the same way loginSession.ts
 * does it for session creation.
 *
 * Priority:
 *  1. X-Forwarded-For leftmost entry (proxy-forwarded real client)
 *  2. req.socket.remoteAddress (direct TCP peer, may be proxy)
 */
export function resolveClientIp(req: IncomingMessage & { ip?: string }): string {
  // For HTTP routes Express already resolved trust proxy → req.ip is correct.
  // For WS upgrade requests req.ip is undefined; fall back to manual resolution.
  if (req.ip) {
    return stripMappedPrefix(req.ip);
  }

  // X-Forwarded-For may contain a comma-separated list; take the leftmost entry.
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
      .split(',')[0]
      .trim();
    if (first) return stripMappedPrefix(first);
  }

  return stripMappedPrefix(req.socket?.remoteAddress ?? 'unknown');
}

/** Strip IPv4-mapped IPv6 prefix: "::ffff:192.168.1.1" → "192.168.1.1" */
function stripMappedPrefix(ip: string): string {
  return ip.replace(/^::ffff:/i, '');
}
