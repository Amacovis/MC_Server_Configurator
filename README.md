# Minecraft Server Configurator

A self-hosted web control panel for managing Minecraft servers on a Linux host.

## What is implemented

- React/Vite admin UI with login, server dashboard, server details, settings, safe file editing, backups, creation, jobs, and app settings routes.
- Node/TypeScript API with cookie sessions, SQLite persistence, audit logging, server import, safe systemd actions, logs, modpack search/version lookup, install jobs, and backup scheduling.
- Linux install assets for a `systemd` service and least-privilege sudoers allowlist.
- Tests for command safety, import matching, backup behavior, API flows, and UI smoke coverage.

## Local development

```bash
npm install
npm run dev:api
npm run dev
```

The frontend runs on `http://localhost:5173` and proxies `/api` to `http://localhost:4174`.

On non-Linux machines, command execution defaults to mock mode so the UI can be developed safely.

## Linux install

After building on the Linux Minecraft host:

```bash
npm install
npm run build
sudo ./scripts/install-linux.sh
```

The setup script creates an app user, directories, a configurator `systemd` unit, and a sudoers file that only permits vetted service/log/archive operations.

