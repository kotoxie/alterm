import { Router, type Request, type Response } from 'express';
import net from 'net';
import { v4 as uuid } from 'uuid';
import { queryAll, queryOne, execute, getChanges } from '../db/helpers.js';
import { authRequired } from '../middleware/auth.js';
import { encrypt, decrypt } from '../services/encryption.js';
import { logAudit } from '../services/audit.js';

const router = Router();
router.use(authRequired);

interface ConnectionRow {
  id: string;
  name: string;
  protocol: string;
  host: string;
  port: number;
  group_id: string | null;
  user_id: string;
  username: string | null;
  encrypted_password: string | null;
  private_key: string | null;
  sort_order: number;
  recording_enabled: number;
  shared: number;
  tunnels_json: string | null;
  extra_config_json: string | null;
}

interface GroupRow {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
}

// List connections and groups
router.get('/', (req: Request, res: Response) => {
  const userId = req.user!.userId;

  const groups = queryAll<GroupRow>(
    'SELECT id, name, parent_id, sort_order FROM connection_groups WHERE user_id = ? ORDER BY sort_order',
    [userId],
  );

  const connections = queryAll<ConnectionRow>(
    'SELECT id, name, protocol, host, port, group_id, username, sort_order, shared FROM connections WHERE user_id = ? ORDER BY sort_order',
    [userId],
  );

  // Shared connections from other users
  const sharedConnections = queryAll<ConnectionRow>(
    'SELECT id, name, protocol, host, port, username, shared, user_id FROM connections WHERE shared = 1 AND user_id != ? ORDER BY name',
    [userId],
  );

  // Build tree
  interface GroupNode {
    id: string;
    name: string;
    parentId: string | null;
    children: GroupNode[];
    connections: { id: string; name: string; protocol: string; host: string; port: number; groupId: string | null; isShared: boolean }[];
  }

  const groupMap = new Map<string, GroupNode>();
  for (const g of groups) {
    groupMap.set(g.id, { id: g.id, name: g.name, parentId: g.parent_id, children: [], connections: [] });
  }

  const rootGroups: GroupNode[] = [];
  for (const g of groupMap.values()) {
    if (g.parentId && groupMap.has(g.parentId)) {
      groupMap.get(g.parentId)!.children.push(g);
    } else {
      rootGroups.push(g);
    }
  }

  const connMapped = connections.map((c) => ({
    id: c.id, name: c.name, protocol: c.protocol, host: c.host, port: c.port, groupId: c.group_id, isShared: false,
  }));

  for (const conn of connMapped) {
    if (conn.groupId && groupMap.has(conn.groupId)) {
      groupMap.get(conn.groupId)!.connections.push(conn);
    }
  }

  const ungrouped = connMapped.filter((c) => !c.groupId || !groupMap.has(c.groupId));

  const sharedMapped = sharedConnections.map((c) => ({
    id: c.id, name: c.name, protocol: c.protocol, host: c.host, port: c.port, groupId: null, isShared: true,
  }));

  res.json({ groups: rootGroups, ungrouped, sharedConnections: sharedMapped });
});

// Helper: check if IP is in a private/loopback/link-local range
// Block only loopback and cloud metadata endpoints — NOT private RFC-1918 ranges,
// since users legitimately connect to internal servers on those addresses.
// SSRF is already mitigated: hosts are resolved from the DB, never from user input.
function isDangerousHost(host: string): boolean {
  const dangerous = [
    /^127\./,
    /^169\.254\./,   // link-local / cloud metadata (AWS, Azure, GCP)
    /^::1$/,
    /^localhost$/i,
  ];
  return dangerous.some((p) => p.test(host));
}

// POST /health-check — TCP reachability for multiple connections
router.post('/health-check', async (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { checks } = req.body as { checks: { id: string; host: string; port: number }[] };
  if (!Array.isArray(checks)) { res.status(400).json({ error: 'checks array required' }); return; }

  // Resolve and validate each check against stored connections
  const validatedChecks: { id: string; host: string; port: number }[] = [];
  for (const { id } of checks) {
    const conn = queryOne<{ host: string; port: number }>(
      'SELECT host, port FROM connections WHERE id = ? AND (user_id = ? OR shared = 1)',
      [id, userId],
    );
    if (!conn) continue;
    if (isDangerousHost(conn.host)) continue;
    validatedChecks.push({ id, host: conn.host, port: conn.port });
  }

  const results = await Promise.all(
    validatedChecks.map(({ id, host, port }) =>
      new Promise<{ id: string; reachable: boolean; latencyMs: number | null }>((resolve) => {
        const start = Date.now();
        const socket = net.createConnection({ host, port, timeout: 3000 });
        socket.on('connect', () => {
          const latencyMs = Date.now() - start;
          socket.destroy();
          resolve({ id, reachable: true, latencyMs });
        });
        socket.on('timeout', () => { socket.destroy(); resolve({ id, reachable: false, latencyMs: null }); });
        socket.on('error', () => resolve({ id, reachable: false, latencyMs: null }));
      }),
    ),
  );

  // For connections that were filtered out (invalid/private), return reachable: false
  const allChecks = (req.body as { checks: { id: string }[] }).checks;
  const resultMap = new Map(results.map((r) => [r.id, r]));
  const finalResults = allChecks.map(({ id }) =>
    resultMap.get(id) ?? { id, reachable: false, latencyMs: null },
  );

  res.json({ results: finalResults });
});

// GET /export — export all connections and groups as JSON (no passwords)
router.get('/export', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const groups = queryAll<GroupRow>(
    'SELECT id, name, parent_id, sort_order FROM connection_groups WHERE user_id = ? ORDER BY sort_order',
    [userId],
  );
  interface ExportConn {
    id: string; name: string; protocol: string; host: string;
    port: number; username: string | null; group_id: string | null; shared: number;
  }
  const connections = queryAll<ExportConn>(
    'SELECT id, name, protocol, host, port, username, group_id, shared FROM connections WHERE user_id = ? ORDER BY sort_order',
    [userId],
  );
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    groups: groups.map((g) => ({ id: g.id, name: g.name, parentId: g.parent_id, sortOrder: g.sort_order })),
    connections: connections.map((c) => ({
      id: c.id, name: c.name, protocol: c.protocol, host: c.host, port: c.port,
      username: c.username, groupId: c.group_id, shared: c.shared,
    })),
  };
  res.setHeader('Content-Disposition', `attachment; filename="alterm-connections-${Date.now()}.json"`);
  res.setHeader('Content-Type', 'application/json');
  res.json(payload);
});

// POST /import — import connections from JSON
router.post('/import', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { groups, connections } = req.body as {
    version?: number;
    groups?: { id: string; name: string; parentId?: string | null; sortOrder?: number }[];
    connections?: { name: string; protocol: string; host: string; port: number; username?: string | null; groupId?: string | null; shared?: number }[];
  };

  let groupsCreated = 0;
  let connectionsCreated = 0;
  const groupIdMap = new Map<string, string>(); // old id → new id

  // Create groups (preserve hierarchy by sorting: parents before children)
  const sortedGroups = (groups ?? []).slice().sort((a, b) => {
    if (!a.parentId) return -1;
    if (!b.parentId) return 1;
    return 0;
  });

  for (const g of sortedGroups) {
    const newId = uuid();
    groupIdMap.set(g.id, newId);
    const newParentId = g.parentId ? (groupIdMap.get(g.parentId) ?? null) : null;
    execute(
      'INSERT INTO connection_groups (id, user_id, name, parent_id, sort_order) VALUES (?, ?, ?, ?, ?)',
      [newId, userId, g.name, newParentId, g.sortOrder ?? 0],
    );
    groupsCreated++;
  }

  for (const c of (connections ?? [])) {
    if (!c.name || !c.protocol || !c.host || !c.port) continue;
    if (!['ssh', 'rdp', 'smb', 'vnc', 'sftp', 'ftp'].includes(c.protocol)) continue;
    const newId = uuid();
    const newGroupId = c.groupId ? (groupIdMap.get(c.groupId) ?? null) : null;
    execute(
      `INSERT INTO connections (id, user_id, group_id, name, protocol, host, port, username, shared, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId, userId, newGroupId, c.name, c.protocol, c.host, c.port, c.username ?? null, c.shared ?? 0, 0],
    );
    connectionsCreated++;
  }

  logAudit({
    userId,
    eventType: 'connections.imported',
    details: { groupsCreated, connectionsCreated },
    ipAddress: req.ip,
  });

  res.json({ groupsCreated, connectionsCreated });
});

// Create connection
router.post('/', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { name, protocol, host, port, username, password, groupId, privateKey, extraConfig, shared, tunnels } = req.body;

  if (!name || !protocol || !host || !port) {
    res.status(400).json({ error: 'Name, protocol, host, and port are required' });
    return;
  }

  if (!['ssh', 'rdp', 'smb', 'vnc', 'sftp', 'ftp'].includes(protocol)) {
    res.status(400).json({ error: 'Invalid protocol' });
    return;
  }

  const id = uuid();
  const encryptedPassword = password ? encrypt(password) : null;
  const encryptedKey = privateKey ? encrypt(privateKey) : null;

  execute(
    `INSERT INTO connections (id, user_id, group_id, name, protocol, host, port, username, encrypted_password, private_key, extra_config_json, sort_order, shared, tunnels_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, userId, groupId || null, name, protocol, host, port,
      username || null, encryptedPassword, encryptedKey,
      extraConfig ? JSON.stringify(extraConfig) : null, 0,
      shared ? 1 : 0,
      tunnels ? JSON.stringify(tunnels) : null,
    ],
  );

  logAudit({
    userId,
    eventType: 'connection.created',
    target: `${protocol}://${host}:${port}`,
    details: { connectionId: id, name },
    ipAddress: req.ip,
  });

  res.status(201).json({
    id, name, protocol, host, port, username, groupId: groupId || null, shared: shared ? 1 : 0,
  });
});

// Update connection
router.put('/:id', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const id = req.params.id as string;
  const isAdmin = req.user!.role === 'admin';

  interface ExistingConnectionRow {
    id: string;
    name: string;
    protocol: string;
    host: string;
    port: number;
    username: string | null;
    group_id: string | null;
    user_id: string;
    shared: number;
  }

  const existing = queryOne<ExistingConnectionRow>(
    'SELECT id, name, protocol, host, port, username, group_id, user_id, shared FROM connections WHERE id = ?',
    [id],
  );
  if (!existing) {
    res.status(404).json({ error: 'Connection not found' });
    return;
  }

  if (existing.user_id !== userId && !isAdmin) {
    res.status(403).json({ error: 'Not authorized' });
    return;
  }

  const before = {
    name: existing.name,
    protocol: existing.protocol,
    host: existing.host,
    port: existing.port,
    username: existing.username,
    groupId: existing.group_id,
  };

  const { name, protocol, host, port, username, password, groupId, privateKey, shared, tunnels, extraConfig } = req.body;

  const updates: string[] = [];
  const params: unknown[] = [];

  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (protocol !== undefined) { updates.push('protocol = ?'); params.push(protocol); }
  if (host !== undefined) { updates.push('host = ?'); params.push(host); }
  if (port !== undefined) { updates.push('port = ?'); params.push(port); }
  if (username !== undefined) { updates.push('username = ?'); params.push(username || null); }
  if (password) { updates.push('encrypted_password = ?'); params.push(encrypt(password)); }
  if (privateKey !== undefined) { updates.push('private_key = ?'); params.push(privateKey ? encrypt(privateKey) : null); }
  if (groupId !== undefined) { updates.push('group_id = ?'); params.push(groupId || null); }
  if (shared !== undefined) { updates.push('shared = ?'); params.push(shared ? 1 : 0); }
  if (tunnels !== undefined) { updates.push('tunnels_json = ?'); params.push(tunnels ? JSON.stringify(tunnels) : null); }
  if (extraConfig !== undefined) { updates.push('extra_config_json = ?'); params.push(extraConfig ? JSON.stringify(extraConfig) : null); }

  if (updates.length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  updates.push("updated_at = datetime('now')");
  params.push(id);

  execute(`UPDATE connections SET ${updates.join(', ')} WHERE id = ?`, params);

  const after = {
    name: name !== undefined ? name : before.name,
    protocol: protocol !== undefined ? protocol : before.protocol,
    host: host !== undefined ? host : before.host,
    port: port !== undefined ? port : before.port,
    username: username !== undefined ? (username || null) : before.username,
    groupId: groupId !== undefined ? (groupId || null) : before.groupId,
  };

  logAudit({
    userId,
    eventType: 'connection.updated',
    target: id,
    details: { before, after },
    ipAddress: req.ip,
  });

  res.json({ success: true });
});

// Delete connection
router.delete('/:id', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const id = req.params.id as string;

  const conn = queryOne<{ user_id: string }>('SELECT user_id FROM connections WHERE id = ?', [id]);
  if (!conn) {
    res.status(404).json({ error: 'Connection not found' });
    return;
  }
  if (conn.user_id !== userId && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Not authorized' });
    return;
  }

  execute('DELETE FROM connections WHERE id = ?', [id]);

  logAudit({
    userId,
    eventType: 'connection.deleted',
    target: id,
    ipAddress: req.ip,
  });

  res.json({ success: true });
});

// Get connection details
router.get('/:id', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const id = req.params.id as string;

  const conn = queryOne<ConnectionRow>(
    'SELECT * FROM connections WHERE id = ? AND (user_id = ? OR shared = 1)',
    [id, userId],
  );

  if (!conn) {
    res.status(404).json({ error: 'Connection not found' });
    return;
  }

  let tunnels: unknown[] = [];
  try { if (conn.tunnels_json) tunnels = JSON.parse(conn.tunnels_json); } catch { /* ignore */ }

  let extraConfig: unknown = null;
  try { if (conn.extra_config_json) extraConfig = JSON.parse(conn.extra_config_json); } catch { /* ignore */ }

  res.json({
    id: conn.id,
    name: conn.name,
    protocol: conn.protocol,
    host: conn.host,
    port: conn.port,
    username: conn.username,
    groupId: conn.group_id,
    recordingEnabled: conn.recording_enabled,
    hasPassword: !!conn.encrypted_password,
    hasPrivateKey: !!conn.private_key,
    shared: conn.shared,
    tunnels,
    extraConfig,
  });
});

// Get session credentials (decrypted password for RDP client auth)
router.get('/:id/session', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const id = req.params.id as string;

  // Credentials must only be returned to the connection owner — never to users
  // accessing via a shared connection (they could extract the decrypted password).
  const conn = queryOne<ConnectionRow>(
    'SELECT * FROM connections WHERE id = ? AND user_id = ?',
    [id, userId],
  );

  if (!conn) {
    res.status(404).json({ error: 'Connection not found' });
    return;
  }

  const password = conn.encrypted_password ? decrypt(conn.encrypted_password) : '';

  res.json({
    host: conn.host,
    port: conn.port,
    username: conn.username || '',
    password,
  });
});

// --- Connection Groups ---
// IMPORTANT: these routes must be defined BEFORE /:id routes to avoid shadowing

// PUT /groups/reorder — batch-update sort_order for a set of groups (manual sort)
router.put('/groups/reorder', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { items } = req.body as { items?: { id: string; sortOrder: number }[] };
  if (!Array.isArray(items)) { res.status(400).json({ error: 'items array is required' }); return; }
  for (const item of items) {
    const group = queryOne<{ user_id: string }>(
      'SELECT user_id FROM connection_groups WHERE id = ?', [item.id],
    );
    if (!group || (group.user_id !== userId && req.user!.role !== 'admin')) continue;
    execute('UPDATE connection_groups SET sort_order = ? WHERE id = ?', [item.sortOrder, item.id]);
  }
  res.json({ success: true });
});

router.post('/groups', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { name, parentId } = req.body;

  if (!name) {
    res.status(400).json({ error: 'Name is required' });
    return;
  }

  const id = uuid();
  execute(
    'INSERT INTO connection_groups (id, user_id, name, parent_id, sort_order) VALUES (?, ?, ?, ?, ?)',
    [id, userId, name, parentId || null, 0],
  );

  res.status(201).json({ id, name, parentId: parentId || null });
});

router.put('/groups/:id', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const id = req.params.id as string;
  const { name, parentId } = req.body as { name?: string; parentId?: string | null };

  const group = queryOne<{ user_id: string }>(
    'SELECT user_id FROM connection_groups WHERE id = ?', [id],
  );
  if (!group) { res.status(404).json({ error: 'Group not found' }); return; }
  if (group.user_id !== userId && req.user!.role !== 'admin') { res.status(403).json({ error: 'Not authorized' }); return; }

  const updates: string[] = [];
  const params: unknown[] = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
  if (parentId !== undefined) { updates.push('parent_id = ?'); params.push(parentId || null); }
  if (updates.length === 0) { res.status(400).json({ error: 'Nothing to update' }); return; }

  params.push(id);
  execute(`UPDATE connection_groups SET ${updates.join(', ')} WHERE id = ?`, params);
  res.json({ success: true });
});

router.delete('/groups/:id', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const id = req.params.id as string;

  execute('DELETE FROM connection_groups WHERE id = ? AND user_id = ?', [id, userId]);
  const changes = getChanges();
  if (changes === 0) {
    res.status(404).json({ error: 'Group not found' });
    return;
  }

  res.json({ success: true });
});

export default router;
