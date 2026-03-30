<div align="center">

# ⚡ Alterm vs Apache Guacamole

### How does Alterm stack up against the most popular open-source remote access gateway?

</div>

---

Apache Guacamole is a well-established, battle-tested remote access gateway — and it's been the go-to choice for years. But it was designed in a different era. Alterm was built from the ground up with a modern stack, a single-container philosophy, and the features that today's teams actually need.

Here's how they compare.

---

## 🏗️ Architecture & Deployment

| | Alterm | Guacamole |
|---|---|---|
| **Single container deployment** | ✅ | ❌ |
| **Lightweight image (~150 MB)** | ✅ | ❌ |
| **No Java runtime required** | ✅ | ❌ |
| **No external database required** | ✅ | ❌ |

> **Why it matters:** Guacamole requires orchestrating three separate services — the `guacd` daemon, the Java/Tomcat web application, and a MySQL or PostgreSQL database. That's three containers to maintain, monitor, and upgrade. Alterm ships everything — app server, database, and TLS — in a single ~150 MB container. One `docker compose up` and you're done.

---

## 🌐 Protocol Support

| | Alterm | Guacamole |
|---|---|---|
| **RDP** | ✅ | ✅ |
| **SSH** | ✅ | ✅ |
| **VNC** | ✅ | ✅ |
| **Telnet** | ✅ | ✅ |
| **SFTP file browser** | ✅ | ⚠️ Basic sidebar only |
| **SMB file browser** | ✅ | ❌ |
| **FTP file browser** | ✅ | ❌ |

> **Why it matters:** Both tools cover the core remote protocols. But when you need to browse files on a Windows share (SMB) or an FTP server, Guacamole can't help — you'll need a separate tool. Alterm handles it natively with a full-featured file browser across all three file protocols.

---

## 📁 File Management

| | Alterm | Guacamole |
|---|---|---|
| **Browse files** | ✅ | ⚠️ SFTP sidebar only |
| **Upload & download** | ✅ | ⚠️ SFTP only |
| **Rename files** | ✅ | ❌ |
| **Copy & paste files** | ✅ | ❌ |
| **Move files** | ✅ | ❌ |
| **Create folders** | ✅ | ❌ |
| **View file info & permissions** | ✅ | ❌ |
| **Change permissions (chmod)** | ✅ | ❌ |
| **Multi-file selection** | ✅ | ❌ |

> **Why it matters:** Guacamole's file support is a narrow SFTP sidebar inside SSH sessions — upload, download, and that's about it. Alterm gives you a proper file manager with rename, copy/paste, move, permission editing, and multi-select bulk operations. It's the difference between a workaround and a workflow.

---

## 🎬 Recording & Audit

| | Alterm | Guacamole |
|---|---|---|
| **RDP session recording** | ✅ | ✅ |
| **SSH terminal recording** | ✅ | ❌ |
| **SSH command-level audit log** | ✅ | ❌ |
| **Password redaction in logs** | ✅ | ❌ |
| **File activity recording** | ✅ | ❌ |
| **Recording encryption at rest** | ✅ | ❌ |
| **In-browser playback** | ✅ | ✅ |
| **Click ripple indicators (RDP)** | ✅ | ❌ |

> **Why it matters:** Guacamole records graphical sessions (RDP/VNC) but leaves SSH completely unrecorded — no terminal replay, no command history. Alterm records SSH sessions as asciinema, logs every command with timestamps, automatically redacts passwords from audit trails, and encrypts all recordings at rest. For compliance and forensics, there's no comparison.

---

## 🔒 Security & Access Control

| | Alterm | Guacamole |
|---|---|---|
| **Granular RBAC (22 permissions)** | ✅ | ❌ |
| **Custom roles** | ✅ | ❌ |
| **Per-protocol access control** | ✅ | ❌ |
| **Connection sharing (user/role)** | ✅ | ⚠️ Link-based sharing only |
| **LDAP authentication** | ✅ | ✅ |
| **OpenID Connect SSO** | ✅ | ✅ |
| **MFA (TOTP)** | ✅ | ✅ |
| **IP access rules** | ✅ | ❌ |
| **Brute-force lockout** | ✅ | ⚠️ Extension required |
| **Idle timeout with countdown** | ✅ | ⚠️ Basic timeout only |
| **Encryption key management** | ✅ | ❌ |
| **Encrypted backups** | ✅ | ❌ |
| **Runs as non-root** | ✅ | ✅ |

> **Why it matters:** Guacamole's permission model is simple — users, groups, and connections. That works for small teams, but it can't express rules like "this role can use SSH and SFTP but not RDP" or "share this connection with the DevOps role only." Alterm's RBAC has 22 distinct permissions across 6 categories, with fully custom roles and per-protocol control.

---

## 🖥️ User Experience

| | Alterm | Guacamole |
|---|---|---|
| **Modern dark UI** | ✅ | ❌ |
| **Tabbed sessions** | ✅ | ❌ |
| **Tab drag-and-drop reordering** | ✅ | ❌ |
| **Split view** | ✅ | ❌ |
| **Connection search** | ✅ | ❌ |
| **Connection tags & filtering** | ✅ | ❌ |
| **Drag-drop connection sorting** | ✅ | ❌ |
| **Copy on select / paste on click** | ✅ | ❌ |
| **Auto-close disconnected tabs** | ✅ | ❌ |
| **Persistent folder state** | ✅ | ❌ |

> **Why it matters:** Guacamole's GWT-based UI is functional but shows its age — no tabs, no split view, no drag-and-drop, no search. If you manage dozens of connections, navigating Guacamole can be tedious. Alterm's modern React interface is built for power users who live in the terminal.

---

## 💾 Backup & Administration

| | Alterm | Guacamole |
|---|---|---|
| **Encrypted full backup** | ✅ | ❌ |
| **One-click restore** | ✅ | ❌ |
| **Connection import/export (JSON)** | ✅ | ❌ |
| **Health check endpoint** | ✅ | ✅ |
| **Version update notifications** | ✅ | ❌ |
| **Audit trail with diffs** | ✅ | ⚠️ Connection logs only |

> **Why it matters:** Backing up Guacamole means separately dumping the database, copying recording files, and managing config files across multiple containers. Alterm exports everything — database, recordings, and encryption key — into a single password-protected `.aeb` file. Restore is a one-click upload.

---

## The Bottom Line

Apache Guacamole is a proven, reliable tool that has served the community well. It's the right choice if you need SAML support, RADIUS authentication, or have an existing Java infrastructure.

**Alterm is for teams who want:**

- 🏎️ **Faster setup** — one container, zero dependencies, running in under a minute
- 📁 **Real file management** — not just a sidebar, but a full file browser across SFTP, SMB, and FTP
- 🔍 **Deep audit trail** — every SSH command, every file operation, every login — all logged and searchable
- 🔐 **Granular security** — 22 permissions, custom roles, per-protocol access, encrypted everything
- ✨ **Modern UX** — tabs, split view, drag-and-drop, search, tags, dark theme

---

<div align="center">

**[Get Started →](README.md#-quick-start)**

</div>
