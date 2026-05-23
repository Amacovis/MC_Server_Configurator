#!/usr/bin/env bash
set -euo pipefail

APP_USER="${MCSC_USER:-mcsc}"
APP_DIR="${MCSC_APP_DIR:-/opt/mc-server-configurator}"
SERVER_ROOT="${MCSC_SERVER_ROOT:-/home/amacovis/Desktop/minecraft}"
BACKUP_ROOT="${MCSC_BACKUP_ROOT:-/opt/minecraft/backups}"
DATA_DIR="${MCSC_DATA_DIR:-/var/lib/mc-server-configurator}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run this installer with sudo." >&2
  exit 1
fi

id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"

mkdir -p "$APP_DIR" "$SERVER_ROOT" "$BACKUP_ROOT" "$DATA_DIR"
rsync -a --delete --exclude node_modules --exclude .git --exclude data --exclude backups ./ "$APP_DIR"/
chown -R "$APP_USER:$APP_USER" "$APP_DIR" "$DATA_DIR" "$SERVER_ROOT" "$BACKUP_ROOT"

install -m 0644 deploy/mc-server-configurator.service /etc/systemd/system/mc-server-configurator.service
install -m 0440 deploy/mcsc-sudoers /etc/sudoers.d/mcsc

systemctl daemon-reload
systemctl enable mc-server-configurator.service

echo "Installed. Set MCSC_INITIAL_PASSWORD in /etc/systemd/system/mc-server-configurator.service before first start if you do not want the default bootstrap password."
echo "Start with: sudo systemctl start mc-server-configurator"
