import { getSetting } from './settings.js';
import { decrypt } from './encryption.js';
import { randomBytes } from 'crypto';

// In-memory state store for OIDC flows (state → { nonce, createdAt })
const stateStore = new Map<string, { nonce: string; createdAt: number }>();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of stateStore) {
    if (now - v.createdAt > STATE_TTL_MS) stateStore.delete(k);
  }
}, 60_000);

export interface OidcUserInfo {
  sub: string;
  username: string;
  email: string | null;
  displayName: string | null;
  isAdmin: boolean;
}

interface OidcConfig {
  clientId: string;
  clientSecret: string;
  providerUrl: string;
  redirectUri: string;
  scope: string;
}

function getOidcConfig(): OidcConfig | null {
  const providerUrl = getSetting('auth.oidc_provider_url');
  const clientId = getSetting('auth.oidc_client_id');
  const encSecret = getSetting('auth.oidc_client_secret');
  const redirectUri = getSetting('auth.oidc_redirect_uri');
  if (!providerUrl || !clientId || !redirectUri) return null;
  const clientSecret = encSecret
    ? (() => { try { return decrypt(encSecret); } catch { return encSecret; } })()
    : '';
  const scope = getSetting('auth.oidc_scope') || 'openid email profile';
  return { clientId, clientSecret, providerUrl, redirectUri, scope };
}

export async function buildOidcAuthUrl(): Promise<{ url: string; state: string } | { error: string }> {
  const cfg = getOidcConfig();
  if (!cfg) {
    if (!getSetting('auth.oidc_provider_url')) return { error: 'OIDC provider URL is not configured' };
    if (!getSetting('auth.oidc_client_id'))   return { error: 'OIDC client ID is not configured' };
    if (!getSetting('auth.oidc_redirect_uri')) return { error: 'OIDC redirect URI is not configured' };
    return { error: 'OIDC configuration is incomplete' };
  }

  const discoveryUrl = cfg.providerUrl.replace(/\/$/, '') + '/.well-known/openid-configuration';
  let authEndpoint: string;
  try {
    const res = await fetch(discoveryUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${discoveryUrl}`);
    const doc = await res.json() as { authorization_endpoint: string };
    authEndpoint = doc.authorization_endpoint;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[OIDC] Discovery error:', msg);
    return { error: `OIDC discovery failed: ${msg}. Verify the Provider URL points to the base of your IdP (e.g. https://accounts.google.com, not the discovery URL itself).` };
  }

  const state = randomBytes(16).toString('hex');
  const nonce = randomBytes(16).toString('hex');
  stateStore.set(state, { nonce, createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: cfg.scope,
    state,
    nonce,
  });

  return { url: `${authEndpoint}?${params.toString()}`, state };
}

export async function handleOidcCallback(
  code: string,
  state: string,
): Promise<OidcUserInfo | null> {
  const stored = stateStore.get(state);
  if (!stored) {
    console.error('[OIDC] Unknown or expired state');
    return null;
  }
  stateStore.delete(state);

  if (Date.now() - stored.createdAt > STATE_TTL_MS) {
    console.error('[OIDC] State expired');
    return null;
  }

  const cfg = getOidcConfig();
  if (!cfg) return null;

  const discoveryUrl = cfg.providerUrl.replace(/\/$/, '') + '/.well-known/openid-configuration';
  let tokenEndpoint: string;
  let userinfoEndpoint: string;
  try {
    const res = await fetch(discoveryUrl);
    const doc = await res.json() as { token_endpoint: string; userinfo_endpoint: string };
    tokenEndpoint = doc.token_endpoint;
    userinfoEndpoint = doc.userinfo_endpoint;
  } catch (err) {
    console.error('[OIDC] Discovery error:', err instanceof Error ? err.message : err);
    return null;
  }

  let accessToken: string;
  let idTokenClaims: Record<string, unknown>;
  try {
    const tokenRes = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64'),
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: cfg.redirectUri,
        client_id: cfg.clientId,
      }).toString(),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error('[OIDC] Token exchange failed:', errBody);
      return null;
    }

    const tokenData = await tokenRes.json() as { access_token: string; id_token?: string };
    accessToken = tokenData.access_token;

    if (tokenData.id_token) {
      const parts = tokenData.id_token.split('.');
      if (parts.length === 3) {
        try {
          idTokenClaims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
        } catch {
          idTokenClaims = {};
        }
      } else {
        idTokenClaims = {};
      }
    } else {
      idTokenClaims = {};
    }
  } catch (err) {
    console.error('[OIDC] Token exchange error:', err instanceof Error ? err.message : err);
    return null;
  }

  let userinfo: Record<string, unknown>;
  try {
    const uiRes = await fetch(userinfoEndpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!uiRes.ok) throw new Error(`Userinfo failed: ${uiRes.status}`);
    userinfo = await uiRes.json() as Record<string, unknown>;
  } catch (err) {
    console.error('[OIDC] Userinfo error:', err instanceof Error ? err.message : err);
    userinfo = idTokenClaims;
  }

  const merged = { ...idTokenClaims, ...userinfo };

  const usernameClaim = getSetting('auth.oidc_username_claim') || 'preferred_username';
  const displayNameClaim = getSetting('auth.oidc_display_name_claim') || 'name';
  const adminGroupClaim = getSetting('auth.oidc_admin_group_claim');
  const adminGroupValue = getSetting('auth.oidc_admin_group_value');

  const sub = String(merged['sub'] ?? '');
  const rawUsername = String(merged[usernameClaim] ?? merged['email'] ?? sub);
  const username = rawUsername.toLowerCase().replace(/[^a-z0-9._-]/g, '_').slice(0, 64);
  const email = merged['email'] ? String(merged['email']) : null;
  const displayName = merged[displayNameClaim] ? String(merged[displayNameClaim]) : null;

  let isAdmin = false;
  if (adminGroupClaim && adminGroupValue) {
    const claimVal = merged[adminGroupClaim];
    if (Array.isArray(claimVal)) {
      isAdmin = claimVal.includes(adminGroupValue);
    } else if (claimVal) {
      isAdmin = String(claimVal) === adminGroupValue;
    }
  }

  if (!sub || !username) return null;

  return { sub, username, email, displayName, isAdmin };
}

export function isOidcEnabled(): boolean {
  return getSetting('auth.oidc_enabled') === 'true';
}
