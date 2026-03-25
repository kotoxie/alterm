import { Client as LdapClient } from 'ldapts';
import { getSetting } from './settings.js';
import { decrypt } from './encryption.js';

export interface LdapUserInfo {
  dn: string;
  username: string;
  email: string | null;
  displayName: string | null;
  isAdmin: boolean;
}

export async function authenticateLdap(username: string, password: string): Promise<LdapUserInfo | null> {
  const ldapUrl = getSetting('auth.ldap_url');
  const bindDn = getSetting('auth.ldap_bind_dn');
  const encBindPw = getSetting('auth.ldap_bind_password');
  const searchBase = getSetting('auth.ldap_search_base');
  const userFilter = getSetting('auth.ldap_user_filter').replace('{username}', escapeLdap(username));
  const usernameAttr = getSetting('auth.ldap_username_attr') || 'uid';
  const emailAttr = getSetting('auth.ldap_email_attr') || 'mail';
  const displayNameAttr = getSetting('auth.ldap_display_name_attr') || 'cn';
  const adminGroupDn = getSetting('auth.ldap_admin_group_dn');
  const rejectUnauthorized = getSetting('auth.ldap_tls_reject_unauthorized') !== 'false';

  if (!ldapUrl || !searchBase) return null;

  const bindPassword = encBindPw
    ? (() => { try { return decrypt(encBindPw); } catch { return encBindPw; } })()
    : '';

  const client = new LdapClient({
    url: ldapUrl,
    tlsOptions: { rejectUnauthorized },
    connectTimeout: 5000,
  });

  try {
    if (bindDn && bindPassword) {
      await client.bind(bindDn, bindPassword);
    }

    const { searchEntries } = await client.search(searchBase, {
      scope: 'sub',
      filter: userFilter,
      attributes: [usernameAttr, emailAttr, displayNameAttr, 'dn', 'memberOf'],
      sizeLimit: 1,
    });

    if (searchEntries.length === 0) return null;

    const entry = searchEntries[0];
    const userDn = entry.dn;

    await client.unbind();

    // Re-connect and bind as user to verify password
    const userClient = new LdapClient({
      url: ldapUrl,
      tlsOptions: { rejectUnauthorized },
      connectTimeout: 5000,
    });

    try {
      await userClient.bind(userDn, password);
    } catch {
      return null;
    } finally {
      await userClient.unbind().catch(() => {});
    }

    const getAttr = (attr: string): string | null => {
      const val = entry[attr];
      if (!val) return null;
      return Array.isArray(val) ? String(val[0]) : String(val);
    };

    let isAdmin = false;
    if (adminGroupDn) {
      const memberOf = entry['memberOf'];
      const groups: string[] = Array.isArray(memberOf)
        ? memberOf.map(String)
        : memberOf ? [String(memberOf)] : [];
      isAdmin = groups.some((g) => g.toLowerCase() === adminGroupDn.toLowerCase());
    }

    return {
      dn: userDn,
      username: getAttr(usernameAttr) ?? username,
      email: getAttr(emailAttr),
      displayName: getAttr(displayNameAttr),
      isAdmin,
    };
  } catch (err) {
    console.error('[LDAP] Error:', err instanceof Error ? err.message : err);
    return null;
  } finally {
    await client.unbind().catch(() => {});
  }
}

function escapeLdap(str: string): string {
  return str.replace(/[\\*()[\]]/g, (c) => `\\${c.charCodeAt(0).toString(16)}`);
}
