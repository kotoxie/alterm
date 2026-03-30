import { Router, type Request, type Response } from 'express';
import crypto from 'crypto';
import { authRequired, requirePermission } from '../middleware/auth.js';
import { queryAll, queryOne, execute, getChanges } from '../db/helpers.js';
import { ALL_PERMISSIONS, PERMISSION_GROUPS, DEFAULT_BUILTIN_PERMISSIONS } from '../services/permissions.js';
import { logAudit } from '../services/audit.js';

const router = Router();

// All routes require auth
router.use(authRequired);

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  is_builtin: number;
  permissions_json: string;
  created_at: string;
  updated_at: string;
}

function parseRole(r: RoleRow) {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? '',
    isBuiltin: r.is_builtin === 1,
    permissions: JSON.parse(r.permissions_json || '[]') as string[],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// GET /roles — list all roles (any authenticated user can list for UI dropdowns)
router.get('/', (_req: Request, res: Response) => {
  const rows = queryAll<RoleRow>('SELECT * FROM roles ORDER BY is_builtin DESC, name');
  res.json(rows.map(parseRole));
});

// GET /roles/permissions — list all permission keys grouped (for role editor UI)
router.get('/permissions', (_req: Request, res: Response) => {
  res.json(PERMISSION_GROUPS);
});

// POST /roles — create custom role
router.post('/', requirePermission('roles.manage'), (req: Request, res: Response) => {
  const { name, description, permissions } = req.body as {
    name?: string; description?: string; permissions?: string[];
  };
  if (!name?.trim()) { res.status(400).json({ error: 'Name is required' }); return; }

  // Validate permissions
  const validPerms = (permissions ?? []).filter(p => (ALL_PERMISSIONS as readonly string[]).includes(p));

  const id = crypto.randomUUID();
  execute(
    `INSERT INTO roles (id, name, description, is_builtin, permissions_json) VALUES (?, ?, ?, 0, ?)`,
    [id, name.trim(), (description ?? '').trim(), JSON.stringify(validPerms)],
  );
  const row = queryOne<RoleRow>('SELECT * FROM roles WHERE id = ?', [id]);
  logAudit({
    userId: req.user!.userId,
    eventType: 'role.created',
    target: name.trim(),
    details: { roleId: id, permissions: validPerms },
    ipAddress: req.ip,
  });
  res.status(201).json(parseRole(row!));
});

// PUT /roles/:id — update role (builtin roles: only permissions editable)
router.put('/:id', requirePermission('roles.manage'), (req: Request, res: Response) => {
  const { id } = req.params;
  const existing = queryOne<RoleRow>('SELECT * FROM roles WHERE id = ?', [id]);
  if (!existing) { res.status(404).json({ error: 'Role not found' }); return; }

  const { name, description, permissions } = req.body as {
    name?: string; description?: string; permissions?: string[];
  };

  const validPerms = (permissions ?? JSON.parse(existing.permissions_json))
    .filter((p: string) => (ALL_PERMISSIONS as readonly string[]).includes(p));

  const beforePerms = JSON.parse(existing.permissions_json || '[]') as string[];

  if (existing.is_builtin) {
    // Builtin: only permissions can change
    execute(
      `UPDATE roles SET permissions_json = ?, updated_at = datetime('now') WHERE id = ?`,
      [JSON.stringify(validPerms), id],
    );
  } else {
    const newName = name?.trim() || existing.name;
    const newDesc = description !== undefined ? description.trim() : (existing.description ?? '');
    execute(
      `UPDATE roles SET name = ?, description = ?, permissions_json = ?, updated_at = datetime('now') WHERE id = ?`,
      [newName, newDesc, JSON.stringify(validPerms), id],
    );
  }
  const updated = queryOne<RoleRow>('SELECT * FROM roles WHERE id = ?', [id]);

  const added = validPerms.filter((p: string) => !beforePerms.includes(p));
  const removed = beforePerms.filter((p: string) => !validPerms.includes(p));
  logAudit({
    userId: req.user!.userId,
    eventType: 'role.updated',
    target: updated!.name,
    details: {
      roleId: id,
      ...(added.length ? { permissionsAdded: added } : {}),
      ...(removed.length ? { permissionsRemoved: removed } : {}),
      ...(name && name.trim() !== existing.name ? { nameChanged: { from: existing.name, to: name.trim() } } : {}),
    },
    ipAddress: req.ip,
  });
  res.json(parseRole(updated!));
});

// POST /roles/:id/reset — reset built-in role to default permissions
router.post('/:id/reset', requirePermission('roles.manage'), (req: Request, res: Response) => {
  const { id } = req.params;
  const existing = queryOne<RoleRow>('SELECT * FROM roles WHERE id = ?', [id]);
  if (!existing) { res.status(404).json({ error: 'Role not found' }); return; }
  if (!existing.is_builtin) { res.status(400).json({ error: 'Only built-in roles can be reset' }); return; }

  const roleId = id as string;
  const defaults = DEFAULT_BUILTIN_PERMISSIONS[roleId];
  if (!defaults) { res.status(400).json({ error: 'No defaults defined for this role' }); return; }

  const beforePerms = JSON.parse(existing.permissions_json || '[]') as string[];
  execute(
    `UPDATE roles SET permissions_json = ?, updated_at = datetime('now') WHERE id = ?`,
    [JSON.stringify(defaults), roleId],
  );

  const added = defaults.filter((p: string) => !beforePerms.includes(p));
  const removed = beforePerms.filter((p: string) => !(defaults as string[]).includes(p));
  logAudit({
    userId: req.user!.userId,
    eventType: 'role.reset',
    target: existing.name,
    details: {
      roleId: id,
      ...(added.length ? { permissionsAdded: added } : {}),
      ...(removed.length ? { permissionsRemoved: removed } : {}),
    },
    ipAddress: req.ip,
  });

  const updated = queryOne<RoleRow>('SELECT * FROM roles WHERE id = ?', [id]);
  res.json(parseRole(updated!));
});

// DELETE /roles/:id — delete custom role (not builtin)
router.delete('/:id', requirePermission('roles.manage'), (req: Request, res: Response) => {
  const { id } = req.params;
  const existing = queryOne<RoleRow>('SELECT * FROM roles WHERE id = ?', [id]);
  if (!existing) { res.status(404).json({ error: 'Role not found' }); return; }
  if (existing.is_builtin) { res.status(400).json({ error: 'Cannot delete built-in role' }); return; }

  // Check if any users have this role
  const userCount = queryOne<{ cnt: number }>('SELECT COUNT(*) as cnt FROM users WHERE role = ?', [id]);
  if (userCount && userCount.cnt > 0) {
    res.status(400).json({ error: `Cannot delete role — ${userCount.cnt} user(s) still assigned to it` });
    return;
  }

  execute('DELETE FROM roles WHERE id = ?', [id]);
  logAudit({
    userId: req.user!.userId,
    eventType: 'role.deleted',
    target: existing.name,
    details: { roleId: id },
    ipAddress: req.ip,
  });
  res.json({ success: true });
});

export default router;
