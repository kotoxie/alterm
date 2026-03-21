# Alterm - Alternative Terminal

Browser-based remote access manager — RDP, SSH, SMB, VNC, SFTP, and FTP from a single self-hosted Docker container. No client software required.

## Features

### Protocols
- **RDP** — full remote desktop via WebAssembly (IronRDP), with clipboard sync and fullscreen keyboard capture
- **SSH** — full xterm.js terminal with SSH tunnel support and session recording
- **SMB** — file browser for Windows network shares
- **VNC** — remote desktop viewer via noVNC
- **SFTP / FTP** — file browsers for SFTP and FTP servers

### Workspace
- **Split panes** — open up to 4 sessions side by side; each tab is an independent workspace with its own pane layout
- **Session persistence** — sessions survive page refresh without reconnecting
- **Connect-all** — right-click a folder to open every connection inside it at once
- **Close-all** — one-click button to close all open sessions

### Connection management
- **Folders** — organize connections in arbitrarily deep nested folder trees
- **Drag-and-drop** — reorder and move connections and folders freely
- **Right-click menus** — create, edit, delete, or duplicate connections and folders from the sidebar
- **Import / export** — back up and restore the full connection tree as JSON

### Security & administration
- **Multi-user** — user accounts with admin and user roles
- **Audit trail** — every login, session open/close, and configuration change is logged with before/after diffs
- **Session recording** — record SSH sessions and play them back with a timeline scrubber
- **Idle timeout** — configurable automatic logout after inactivity
- **Password reset** and role-based settings access
- **Security lockout** — configurable failed-login lockout rules
- **Self-signed TLS** generated automatically on first launch; bring your own cert optionally

### Infrastructure
- **Single container** — SQLite database, no external dependencies
- **Health check** endpoint at `/health`
- **Version update notifications** — the UI alerts you when a newer image is available

## Quick start

```yaml
services:
  alterm:
    image: ghcr.io/kotoxie/alterm
    container_name: alterm
    ports:
      - '7443:7443'
    volumes:
      - ./data:/app/data
```

Open **https://\<IP_ADDRESS\>:7443** in your browser. On first launch you will be prompted to create an admin account.

> The browser will warn about the self-signed certificate — this is expected. Accept the exception to proceed.

## Configuration

All configuration is done via environment variables in `docker-compose.yml`:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `7443` | HTTPS port |
| `ADMIN_PASSWORD` | *(none)* | Pre-set admin password on first launch (setup screen is skipped) |
| `TLS_CERT_PATH` | *(auto)* | Path to a custom TLS certificate file inside the container |
| `TLS_KEY_PATH` | *(auto)* | Path to a custom TLS private key file inside the container |
| `DATA_DIR` | `/app/data` | Directory for the database, certs, recordings, and logs |

Persistent data is stored in `./data` on the host by default (via the volume mount in `docker-compose.yml`).

## Building from source

```bash
# Build and run locally
docker compose up --build -d

# Or without Docker
npm install
npm run build
npm start
```

Node.js 20+ is required for local development.

## Updating

```bash
docker compose pull && docker compose up -d
```

## License

MIT
