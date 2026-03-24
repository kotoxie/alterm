<div align="center">

# ⚡ Alterm

### Lightning-fast, self-hosted remote access — RDP, SSH, VNC, SMB, SFTP & FTP in one Docker container.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Latest Release](https://img.shields.io/github/v/release/kotoxie/alterm?label=release)](https://github.com/kotoxie/alterm/releases/latest)
[![Docker Image](https://img.shields.io/badge/ghcr.io-kotoxie%2Falterm-blue?logo=docker)](https://ghcr.io/kotoxie/alterm)

**No Web-sockets. No middleware. No Java. Just raw WebAssembly RDP at full speed.**

</div>

---

## 🚀 Why Alterm?

Most browser-based remote access tools relay your display through a server-side engine (engine, proxy, etc.), adding latency and complexity. Alterm's RDP client runs **entirely in your browser** using WebAssembly — pixel-perfect, low-latency RDP with no middleware, no Java, and no extra containers.

One container. Zero dependencies. Open your browser and connect.

---


## 🐳 Quick Start

```yaml
# docker-compose.yml
services:
  alterm:
    image: ghcr.io/kotoxie/alterm:latest
    container_name: alterm
    ports:
      - '7443:7443'
    volumes:
      - ./data:/app/data
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
| **RDP** | WebAssembly-powered (IronRDP) — no Guacamole, no Java, native browser speed. **Session recording via canvas capture (WebM video)** |
| **SSH** | Full xterm.js terminal, port-forward tunnels, session recording & playback |
| **VNC** | Remote desktop via noVNC |
| **SMB** | File browser for Windows network shares |
| **SFTP** | Secure file browser; open directly from any SSH connection |
| **FTP** | File browser for FTP servers |

### 🗂️ Workspace
- **Split panes** — unlimited sessions side by side per tab
- **Session persistence** — survives page refresh without reconnecting
- **Connect-all** — right-click any folder to open every connection at once
- **Close-all** — dismiss all sessions in one click

### 📁 Connection Management
- **Nested folders** — arbitrarily deep folder trees
- **Drag & drop** — reorder connections and folders freely
- **Right-click menus** — full CRUD on connections and folders from the sidebar
- **Import / Export** — backup and restore the full connection tree as JSON

### 🔒 Security & Administration
- **Multi-user** with admin and user roles
- **Audit trail** — every login, session, and config change logged with before/after diffs
- **Session recording** — record SSH sessions (asciinema) and RDP sessions (WebM video), replay in-browser
- **Idle timeout** — configurable auto-logout after inactivity
- **Security lockout** — brute-force protection with configurable failed-login rules
- **TLS** — self-signed cert generated on first launch; bring your own cert optionally

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
| `ADMIN_PASSWORD` | *(none)* | Pre-set admin password on first launch (skips setup screen) |
| `TLS_CERT_PATH` | *(auto)* | Path to a custom TLS certificate inside the container |
| `TLS_KEY_PATH` | *(auto)* | Path to a custom TLS private key inside the container |
| `DATA_DIR` | `/app/data` | Directory for database, certs, recordings, and logs |

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
