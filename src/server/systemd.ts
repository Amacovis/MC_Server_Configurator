import fs from "node:fs";
import path from "node:path";
import { Db } from "./db.js";
import { journalctlArgs, runCommand, systemctlArgs } from "./commands.js";
import { config } from "./config.js";
import { assertServiceName } from "./security.js";
import type { ManagedServer, ServerStatus } from "../shared/types.js";

type ServerRow = Record<string, unknown>;

export function mapServer(row: ServerRow, status: ServerStatus = "unknown"): ManagedServer {
  return {
    id: String(row.id),
    name: String(row.name),
    directory: String(row.directory),
    unitName: String(row.unit_name),
    port: Number(row.port),
    memoryMb: Number(row.memory_mb),
    javaArgs: String(row.java_args ?? ""),
    modpackProvider: row.modpack_provider ? String(row.modpack_provider) as ManagedServer["modpackProvider"] : undefined,
    modpackId: row.modpack_id ? String(row.modpack_id) : undefined,
    modpackName: row.modpack_name ? String(row.modpack_name) : undefined,
    rconEnabled: Boolean(row.rcon_enabled),
    backupMode: String(row.backup_mode) as ManagedServer["backupMode"],
    backupCron: String(row.backup_cron),
    backupRetention: Number(row.backup_retention),
    status,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export async function getStatus(unitName: string): Promise<ServerStatus> {
  const [command, ...args] = systemctlArgs("is-active", unitName);
  const result = await runCommand(command, args, 10_000);
  const value = result.stdout.trim();
  if (value === "active") return "running";
  if (value === "inactive") return "stopped";
  if (value === "failed") return "failed";
  return "unknown";
}

export async function controlServer(unitName: string, action: "start" | "stop" | "restart") {
  const [command, ...args] = systemctlArgs(action, unitName);
  const result = await runCommand(command, args, 45_000);
  if (result.code !== 0) throw new Error(result.stderr || `systemctl ${action} failed`);
  return result;
}

export async function getLogs(unitName: string, lines: number) {
  const [command, ...args] = journalctlArgs(unitName, lines);
  const result = await runCommand(command, args, 15_000);
  if (result.code !== 0) throw new Error(result.stderr || "journalctl failed");
  return result.stdout;
}

export async function listServers(db: Db) {
  const rows = db.prepare("SELECT * FROM servers ORDER BY name").all() as ServerRow[];
  const servers = await Promise.all(rows.map(async (row) => mapServer(row, await getStatus(String(row.unit_name)))));
  return servers;
}

export function importCandidates() {
  if (!fs.existsSync(config.serverRoot)) return [];
  return fs
    .readdirSync(config.serverRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const directory = path.join(config.serverRoot, entry.name);
      const unitName = assertServiceName(`minecraft-${entry.name.replace(/[^A-Za-z0-9_.-]/g, "-")}.service`);
      return {
        name: entry.name.replace(/[-_]+/g, " "),
        directory,
        unitName,
        port: readPort(path.join(directory, "server.properties")),
        memoryMb: 4096,
        javaArgs: "-Xms1G"
      };
    });
}

function readPort(filePath: string) {
  if (!fs.existsSync(filePath)) return 25565;
  const line = fs.readFileSync(filePath, "utf8").split(/\r?\n/).find((item) => item.startsWith("server-port="));
  return line ? Number(line.split("=")[1]) || 25565 : 25565;
}

