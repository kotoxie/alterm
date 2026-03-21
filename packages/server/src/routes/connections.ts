import { Router, type Request, type Response } from 'express';
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

// Create connection
router.post('/', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { name, protocol, host, port, username, password, groupId, privateKey, extraConfig, shared } = req.body;

  if (!name || !protocol || !host || !port) {
    res.status(400).json({ error: 'Name, protocol, host, and port are required' });
    return;
  }

  if (!['ssh', 'rdp', 'smb'].includes(protocol)) {
    res.status(400).json({ error: 'Invalid protocol' });
    return;
  }

  const id = uuid();
  const encryptedPassword = password ? encrypt(password) : null;
  const encryptedKey = privateKey ? encrypt(privateKey) : null;

  execute(
    `INSERT INTO connections (id, user_id, group_id, name, protocol, host, port, username, encrypted_password, private_key, extra_config_json, sort_order, shared)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, userId, groupId || null, name, protocol, host, port,
      username || null, encryptedPassword, encryptedKey,
      extraConfig ? JSON.stringify(extraConfig) : null, 0,
      shared ? 1 : 0,
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

  const { name, protocol, host, port, username, password, groupId, privateKey, shared } = req.body;

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
  });
});

// Get session credentials (decrypted password for RDP client auth)
router.get('/:id/session', (req: Request, res: Response) => {
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
