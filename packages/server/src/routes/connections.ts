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
  username: string | null;
  encrypted_password: string | null;
  private_key: string | null;
  sort_order: number;
  recording_enabled: number;
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
    'SELECT id, name, protocol, host, port, group_id, username, sort_order FROM connections WHERE user_id = ? ORDER BY sort_order',
    [userId],
  );

  // Build tree
  interface GroupNode {
    id: string;
    name: string;
    parentId: string | null;
    children: GroupNode[];
    connections: { id: string; name: string; protocol: string; host: string; port: number; groupId: string | null }[];
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
    id: c.id, name: c.name, protocol: c.protocol, host: c.host, port: c.port, groupId: c.group_id,
  }));

  for (const conn of connMapped) {
    if (conn.groupId && groupMap.has(conn.groupId)) {
      groupMap.get(conn.groupId)!.connections.push(conn);
    }
  }

  const ungrouped = connMapped.filter((c) => !c.groupId || !groupMap.has(c.groupId));

  res.json({ groups: rootGroups, ungrouped });
});

// Create connection
router.post('/', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const { name, protocol, host, port, username, password, groupId, privateKey, extraConfig } = req.body;

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
    `INSERT INTO connections (id, user_id, group_id, name, protocol, host, port, username, encrypted_password, private_key, extra_config_json, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, userId, groupId || null, name, protocol, host, port,
      username || null, encryptedPassword, encryptedKey,
      extraConfig ? JSON.stringify(extraConfig) : null, 0,
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
    id, name, protocol, host, port, username, groupId: groupId || null,
  });
});

// Update connection
router.put('/:id', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const id = req.params.id as string;

  const existing = queryOne('SELECT id FROM connections WHERE id = ? AND user_id = ?', [id, userId]);
  if (!existing) {
    res.status(404).json({ error: 'Connection not found' });
    return;
  }

  const { name, protocol, host, port, username, password, groupId, privateKey } = req.body;

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

  if (updates.length === 0) {
    res.status(400).json({ error: 'No fields to update' });
    return;
  }

  updates.push("updated_at = datetime('now')");
  params.push(id, userId);

  execute(`UPDATE connections SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`, params);

  logAudit({
    userId,
    eventType: 'connection.updated',
    target: id,
    details: { name },
    ipAddress: req.ip,
  });

  res.json({ success: true });
});

// Delete connection
router.delete('/:id', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const id = req.params.id as string;

  execute('DELETE FROM connections WHERE id = ? AND user_id = ?', [id, userId]);
  const changes = getChanges();
  if (changes === 0) {
    res.status(404).json({ error: 'Connection not found' });
    return;
  }

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
    'SELECT * FROM connections WHERE id = ? AND user_id = ?',
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
  });
});

// Get session credentials (decrypted password for RDP client auth)
router.get('/:id/session', (req: Request, res: Response) => {
  const userId = req.user!.userId;
  const id = req.params.id as string;

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
