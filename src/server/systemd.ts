import fs from "node:fs";
import path from "node:path";
import { Db } from "./db.js";
import { journalctlArgs, runCommand, systemctlArgs } from "./commands.js";
import { config } from "./config.js";
import { assertServiceName } from "./security.js";
import type { ManagedServer, ServerStatus } from "../shared/types.js";
import type { ServiceTestResult } from "../shared/types.js";

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
    javaArgsSourceType: row.java_args_source_type ? String(row.java_args_source_type) as ManagedServer["javaArgsSourceType"] : "default",
    javaArgsSourcePath: row.java_args_source_path ? String(row.java_args_source_path) : undefined,
    javaArgsEditable: Boolean(row.java_args_editable),
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
  if (value === "failed") return "stopped";
  return "unknown";
}

export async function testService(unitName: string): Promise<ServiceTestResult> {
  const safeUnit = assertServiceName(unitName);
  const [command, ...args] = systemctlArgs("is-active", safeUnit);
  const result = await runCommand(command, args, 10_000);
  const output = `${result.stdout}\n${result.stderr}`.trim().toLowerCase();
  const rawStatus = result.stdout.trim();

  if (rawStatus === "active" || rawStatus === "inactive" || rawStatus === "failed") {
    return {
      existsLikely: true,
      status: rawStatus,
      message: `${safeUnit} is ${rawStatus}.`
    };
  }

  if (output.includes("not-found") || output.includes("could not be found") || output.includes("not loaded")) {
    return {
      existsLikely: false,
      status: "not-found",
      message: `${safeUnit} was not found by systemd. You can still save it if the service will be created or systemd cannot see it yet.`
    };
  }

  return {
    existsLikely: result.code === 0,
    status: "unknown",
    message: result.code === 0 ? `${safeUnit} returned an unknown state.` : `${safeUnit} could not be confirmed. You can still save it.`
  };
}

export async function controlServer(unitName: string, action: "start" | "stop" | "restart") {
  const [command, ...args] = systemctlArgs(action, unitName);
  const result = await runCommand(command, args, 45_000);
  if (result.code !== 0) throw new Error(result.stderr || `systemctl ${action} failed`);
  if (action === "stop") {
    const [resetCommand, ...resetArgs] = systemctlArgs("reset-failed", unitName);
    await runCommand(resetCommand, resetArgs, 10_000);
  }
  return result;
}

export async function getLogs(unitName: string, lines: number) {
  const [command, ...args] = journalctlArgs(unitName, lines);
  const result = await runCommand(command, args, 15_000);
  if (result.code !== 0) throw new Error(result.stderr || "journalctl failed");
  return result.stdout;
}

export async function discoverCandidateServices() {
  if (config.mockCommands) return [];
  const result = await runCommand("systemctl", ["list-units", "--type=service", "--all", "--no-legend", "--plain"], 20_000);
  if (result.code !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [unitName, load, active, sub, ...description] = line.split(/\s+/);
      return { unitName, load, active, sub, description: description.join(" ") };
    })
    .filter((item) => item.unitName?.endsWith(".service"));
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
