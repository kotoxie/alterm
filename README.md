<div align="center">

# ⚡ Alterm

### Lightning-fast, self-hosted remote access — RDP, SSH, VNC, Telnet, SMB, SFTP & FTP in one Docker container.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Latest Release](https://img.shields.io/github/v/release/kotoxie/alterm?label=release)](https://github.com/kotoxie/alterm/releases/latest)
[![Docker Image](https://img.shields.io/badge/ghcr.io-kotoxie%2Falterm-blue?logo=docker)](https://ghcr.io/kotoxie/alterm)

**No Web-sockets. No middleware. No Java. Just raw WebAssembly RDP at full speed.**

</div>

---

## 📋 Table of Contents

- [Why Alterm?](#-why-alterm)
- [Quick Start](#-quick-start)
- [Features](#-features)
- [Configuration](#️-configuration)
- [Updating](#-updating)
- [Building from Source](#️-building-from-source)
- [License](#-license)

---

## 🚀 Why Alterm?

Most browser-based remote access tools relay your display through a server-side engine, adding latency and complexity. Alterm's RDP client runs **entirely in your browser** using WebAssembly — pixel-perfect, low-latency RDP with no middleware, no Java, and no extra containers.

One container. Zero dependencies. Open your browser and connect.

---

## 🐳 Quick Start

```yaml
# docker-compose.yml
services:
  alterm:
    image: ghcr.io/kotoxie/alterm:latest
    container_name: alterm
    restart: unless-stopped
    ports:
      - '7443:7443'
    volumes:
      - ./data:/app/data
    environment:
      - ALTERM_ENCRYPTION_KEY=your-64-char-hex-key  # openssl rand -hex 32
```

```bash
docker compose up -d
```

Open **`https://<YOUR_IP>:7443`** — on first launch you'll be prompted to create an admin account.

> ⚠️ The browser will warn about the self-signed certificate. Accept the exception to proceed, or mount your own cert (see Configuration below).

---

## ✨ Features

### 🖥️ Protocols
| Protocol | Details |
|---|---|
| **RDP** | WebAssembly-powered — no Guacamole, no Java, native browser speed. Session recording with cursor compositing and **click ripple indicators** (WebM video) |
| **SSH** | Full xterm.js terminal, unlimited width, port-forward tunnels, session recording & playback, **command-level audit log** |
| **VNC** | Remote desktop via noVNC |
| **Telnet** | Full terminal client with IAC negotiation, auto-login, window resize (NAWS), and session recording |
| **SMB** | File browser for Windows network shares |
| **SFTP** | Secure file browser; open directly from any SSH connection (password or private key auth) |
| **FTP** | File browser for FTP servers with optional FTPS support |

### 🗂️ Workspace
- **Split panes** — unlimited sessions side by side per tab
- **Tab drag & drop** — reorder tabs and drag one tab into another to create a split view
- **Session persistence** — survives page refresh without reconnecting
- **Auto-focus** — switching between SSH tabs automatically focuses the terminal
- **Connect-all** — right-click any folder to open every connection at once
- **Close-all** — dismiss all sessions in one click
- **Auto-close on disconnect** — disconnected session tabs close automatically after a 15-second countdown (with cancel option)

### 📁 Connection Management
- **Nested folders** — arbitrarily deep folder trees with **persistent expand/collapse state** across sidebar toggles and page refreshes
- **Drag & drop** — reorder connections and folders freely
- **Connection search** — instant search-as-you-type filter matching name and host
- **Connection tags** — label connections (e.g. `prod`, `linux`, `customer-a`) and filter the sidebar by tag
- **Right-click menus** — full CRUD on connections and folders from the sidebar
- **Import / Export** — backup and restore the full connection tree as JSON
- **Health monitor** — live green/red reachability dots in the sidebar (configurable, enable/disable from settings)

### 🔒 Security & Authentication
- **Granular RBAC** — role-based access control with 22 fine-grained permissions across connections, sessions, audit, admin, and protocols; create custom roles beyond the built-in Admin/User
- **Connection sharing** — share individual connections with specific roles and/or specific users (not just all-or-nothing); collapsible sharing panel in the connection editor
- **Protocol permissions** — control which protocols each role can access (SSH, RDP, VNC, Telnet, SMB, FTP)
- **Local authentication** with bcrypt-hashed passwords and brute-force lockout
- **LDAP / Active Directory** — authenticate users against any LDAP directory; map groups to admin role
- **OpenID Connect (SSO)** — sign in via Azure AD, Okta, Google, Keycloak, or any OIDC-compatible provider; auto-provision users on first login
- **MFA (TOTP)** — per-user authenticator app support with trusted device cookies
- **Authentication Providers** — admin UI to enable/disable local, LDAP, and SSO independently; optionally enforce SSO-only login
- **IP Access Rules** — allowlist or denylist by CIDR range
- **Session recording** — SSH sessions (asciinema) and RDP sessions (WebM video) recorded and **encrypted at rest**, replayed in-browser; RDP recordings include **click ripple indicators** (color-coded: blue=left, red=right, gray=middle); files inaccessible without GUI authentication
- **SSH command audit log** — every command typed in an SSH session is logged with timestamp and output preview, viewable alongside the recording playback; **passwords are automatically redacted** from the audit trail
- **File activity recording** — SFTP, SMB, and FTP sessions log every file operation (browse, upload, download, delete, mkdir) in a searchable timeline
- **Folder delete cascade** — deleting a folder warns before recursively removing all connections inside
- **Idle timeout** — real idle detection (heartbeats don't reset the clock); warning dialog with countdown before auto-logout
- **Max session duration** — hard JWT expiry regardless of activity
- **Audit trail** — every login, session, and config change logged with before/after diffs
- **TLS** — self-signed cert auto-generated on first launch; bring your own cert optionally
- **Runs as non-root** — container drops to unprivileged `node` user at startup via `gosu`
- **Encryption key via env** — `ALTERM_ENCRYPTION_KEY` keeps the key separate from data; falls back to auto-file with a prominent warning

### 💾 Backup & Restore
- **Full system backup** — exports entire database, all session recordings, and the encryption key into a single encrypted `.aeb` file
- **Dedicated backup password** — backups are protected with AES-256-CTR + PBKDF2 (200 000 iterations) + HMAC-SHA256; separate from the login password
- **One-click restore** — upload a `.aeb` file, enter the password, and the system hot-swaps the database and recordings without a restart
- **Destructive-action confirmation** — restore requires an explicit confirmation step before overwriting data

### 🔌 Port-Forward Tunnels (SSH)
- Configure local→remote port forwards per SSH connection
- Per-tunnel status indicators (🟢 listening / 🔴 failed with error message) shown in the session bar
- Tunnels start automatically when the SSH session connects and close with it

### 👥 Multi-User Administration
- **Admin and user roles** with role-based access control
- **User management** — create, edit, and deactivate users from the UI
- **Shared connections** — share connections with all users, specific roles, or specific users
- **Roles management** — create and manage custom roles with granular permission assignments from the settings panel
- **Per-user SSH preferences** — font, theme, cursor, scrollback

### 🏗️ Infrastructure
- **Single container** — SQLite, no external dependencies
- **Health check** at `/health`
- **Version notifications** — the UI alerts you when a newer image is available

---

## ⚙️ Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `7443` | HTTPS port |
| `ALTERM_ENCRYPTION_KEY` | *(auto-generated file)* | 64-char hex AES-256 key for encrypting credentials and recordings. **Set this in production.** Generate with `openssl rand -hex 32` |
| `ADMIN_PASSWORD` | *(none)* | Pre-set admin password on first launch (skips setup screen) |
| `TLS_CERT_PATH` | *(auto)* | Path to a custom TLS certificate inside the container |
| `TLS_KEY_PATH` | *(auto)* | Path to a custom TLS private key inside the container |
| `DATA_DIR` | `/app/data` | Directory for database, certs, recordings, and logs |

### Encryption key

Alterm encrypts all credentials, MFA secrets, and session recordings using AES-256. The key can be supplied in two ways:

1. **Recommended — environment variable:**
   ```bash
   ALTERM_ENCRYPTION_KEY=[Generate encryption key using the command - openssl rand -hex 32]
   ```
   The key lives outside the data volume, so a snapshot of `/data` alone is useless without it.

2. **Fallback — auto-generated file** (`/app/data/encryption.key`): Alterm creates a key automatically if the env var is not set. A **red warning banner** is shown in the server logs and on the login page as a reminder. This is acceptable for local/home-lab use but not recommended for production.

> ⚠️ If you switch from file-based to env-based key, export a backup first (Settings → Backup & Restore) and re-import after setting the new key — the backup is self-contained and includes the key used to encrypt recordings.

---

## 🔄 Updating

```bash
docker compose pull && docker compose up -d
```

---

## 🛠️ Building from Source

```bash
# With Docker
docker compose up --build -d

# Without Docker (Node.js 20+ required)
npm install && npm run build && npm start
```

---

## 📄 License

[MIT]

## Attribution
<a href="https://www.flaticon.com/free-icons/terminal" title="terminal icons">Terminal icons created by msidiqf - Flaticon</a>