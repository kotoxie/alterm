# Alterm

Browser-based remote access manager — RDP, SSH, and SMB from a single self-hosted Docker container. No client software required.

## Features

- **RDP** sessions via WebAssembly (IronRDP)
- **SSH** sessions with a full xterm.js terminal
- **Connection management** — folders, drag-and-drop, edit/delete
- **Multi-user** — user accounts with admin and user roles
- **Audit trail** — every login, session, and change is logged with before/after diffs
- **Settings panel** — per-user profile, SSH appearance, session recording, security lockout rules
- **Self-signed TLS** generated automatically on first launch; bring your own cert optionally
- **Single container** — SQLite database, no external dependencies

## Quick start

```bash
docker compose up -d
```

Open **https://localhost:7443** in your browser. On first launch you will be prompted to create an admin account.

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
