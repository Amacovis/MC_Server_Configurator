import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import type { Db } from "./db.js";
import { runCommand } from "./commands.js";
import { resolveServerPath } from "./security.js";
import type { BackupMode } from "../shared/types.js";

export function validateCron(value: string) {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Use a 5-field cron expression.");
  if (value.length > 64 || /[^0-9*,/\-\s]/.test(value)) throw new Error("Cron expression contains unsupported characters.");
  return value.trim();
}

export function retentionCandidates(backups: Array<{ id: string; createdAt: string }>, keep: number) {
  return backups
    .slice()
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(Math.max(keep, 0));
}

export async function runBackup(db: Db, server: { id: string; name: string; directory: string; unitName: string; backupMode: BackupMode; rconEnabled: boolean }) {
  const id = nanoid();
  const createdAt = new Date().toISOString();
  db.prepare("INSERT INTO backups (id, server_id, status, mode, message, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    id,
    server.id,
    "running",
    server.backupMode,
    "Backup started.",
    createdAt
  );

  try {
    if (server.backupMode === "online" && !server.rconEnabled) {
      throw new Error("Online backups require RCON or console command access. Enable RCON or use stop-then-backup.");
    }

    const serverPath = resolveServerPath(server.directory);
    const destinationDir = path.join(config.backupRoot, safeName(server.name));
    fs.mkdirSync(destinationDir, { recursive: true });
    const destination = path.join(destinationDir, `${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz`);

    if (server.backupMode === "online") {
      await runMinecraftCommand(server, "save-off");
      await runMinecraftCommand(server, "save-all flush");
    } else {
      await runCommand("systemctl", ["stop", server.unitName], 60_000);
    }

    await archiveDirectory(serverPath, destination);

    if (server.backupMode === "online") {
      await runMinecraftCommand(server, "save-on");
    } else {
      await runCommand("systemctl", ["start", server.unitName], 60_000);
    }

    db.prepare("UPDATE backups SET status = ?, path = ?, message = ?, completed_at = ? WHERE id = ?").run(
      "completed",
      destination,
      "Backup completed.",
      new Date().toISOString(),
      id
    );
  } catch (error) {
    db.prepare("UPDATE backups SET status = ?, message = ?, completed_at = ? WHERE id = ?").run(
      "failed",
      error instanceof Error ? error.message : "Backup failed.",
      new Date().toISOString(),
      id
    );
  }

  return db.prepare("SELECT * FROM backups WHERE id = ?").get(id);
}

async function archiveDirectory(source: string, destination: string) {
  if (config.mockCommands) {
    fs.writeFileSync(destination, "mock backup archive\n", "utf8");
    return;
  }
  const result = await runCommand("tar", ["-czf", destination, "-C", source, "."], 120_000);
  if (result.code !== 0) throw new Error(result.stderr || "tar archive failed");
}

async function runMinecraftCommand(server: { unitName: string }, command: string) {
  if (config.mockCommands) return;
  const result = await runCommand("mcsc-rcon", [server.unitName, command], 30_000);
  if (result.code !== 0) throw new Error(result.stderr || `Minecraft command failed: ${command}`);
}

function safeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-|-$/g, "") || "server";
}

