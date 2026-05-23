import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { runCommand } from "./commands.js";
import { assertServiceName } from "./security.js";
import type {
  DiscoveredScript,
  ExternalSchedule,
  ExternalScheduleKind,
  ImportPreview,
  ImportPreviewItem,
  ServerActionKind
} from "../shared/types.js";

export interface UnitInfo {
  unitName: string;
  description?: string;
  workingDirectory?: string;
  execStart?: string;
  fragmentPath?: string;
  content?: string;
}

export interface CronEntry {
  expression: string;
  command: string;
  source: string;
}

export async function buildImportPreview(existingServers: Array<{ directory: string; unitName: string }> = []): Promise<ImportPreview> {
  const folders = listServerFolders(config.serverRoot);
  const units = await discoverSystemdUnits();
  const cronEntries = parseCrontab(await readCrontab());
  const usedUnits = new Set<string>();

  const items = folders.map((folder) => {
    const match = matchFolderToUnit(folder.directory, units);
    if (match.unit?.unitName) usedUnits.add(match.unit.unitName);
    const unitName = match.unit?.unitName ?? assertServiceName(`minecraft-${folder.basename.replace(/[^A-Za-z0-9_.-]/g, "-")}.service`);
    const scripts = discoverScripts(folder.directory);
    const schedules = matchSchedules(folder.directory, unitName, scripts, cronEntries);
    const alreadyImported = existingServers.some((server) => server.directory === folder.directory || server.unitName === unitName);
    const warnings = [
      ...(match.confidence === "low" ? ["Only a naming-pattern service match was found. Review before import."] : []),
      ...(match.confidence === "unmatched" ? ["No matching systemd service was found. The guessed unit may need correction."] : []),
      ...scripts.filter((script) => !script.safe).map((script) => `${script.name}: ${script.reason}`)
    ];

    return {
      id: stableId(folder.directory),
      name: folder.basename.replace(/[-_]+/g, " "),
      directory: folder.directory,
      unitName,
      unitMatchSource: match.source,
      confidence: match.confidence,
      port: readPort(path.join(folder.directory, "server.properties")),
      memoryMb: 4096,
      javaArgs: "-Xms1G",
      alreadyImported,
      scripts,
      externalSchedules: schedules,
      warnings
    } satisfies ImportPreviewItem;
  });

  const matchedFolderText = new Set(items.map((item) => item.directory));
  const unmatchedServices = units
    .filter((unit) => !usedUnits.has(unit.unitName))
    .filter((unit) => mentionsAnyServerRoot(unit, config.serverRoot) && !matchedFolderText.has(unit.workingDirectory ?? ""))
    .map((unit) => ({ unitName: unit.unitName, description: unit.description, matchedText: unit.workingDirectory ?? unit.execStart ?? unit.fragmentPath }));

  return { serverRoot: config.serverRoot, items, unmatchedServices };
}

export function listServerFolders(serverRoot: string) {
  if (!fs.existsSync(serverRoot)) return [];
  return fs
    .readdirSync(serverRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ basename: entry.name, directory: path.join(serverRoot, entry.name) }));
}

export function matchFolderToUnit(folder: string, units: UnitInfo[]) {
  const normalizedFolder = normalizePath(folder);
  const exactWorkingDirectory = units.find((unit) => normalizePath(unit.workingDirectory ?? "") === normalizedFolder);
  if (exactWorkingDirectory) return { unit: exactWorkingDirectory, confidence: "high" as const, source: "WorkingDirectory" };

  const pathReference = units.find((unit) => unitText(unit).includes(normalizedFolder));
  if (pathReference) return { unit: pathReference, confidence: "high" as const, source: "unit path reference" };

  const folderName = path.basename(folder).toLowerCase();
  const nameMatch = units.find((unit) => unit.unitName.toLowerCase() === `minecraft-${folderName}.service`);
  if (nameMatch) return { unit: nameMatch, confidence: "low" as const, source: "naming pattern" };

  return { unit: undefined, confidence: "unmatched" as const, source: "guessed naming pattern" };
}

export function discoverScripts(serverDir: string): DiscoveredScript[] {
  if (!fs.existsSync(serverDir)) return [];
  return fs
    .readdirSync(serverDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isLikelyScript(entry.name))
    .map((entry) => scriptInfo(path.join(serverDir, entry.name), serverDir));
}

export function parseCrontab(raw: string, source = "user crontab"): CronEntry[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(line))
    .flatMap((line) => {
      const parts = line.split(/\s+/);
      if (parts.length < 6) return [];
      return [{ expression: parts.slice(0, 5).join(" "), command: parts.slice(5).join(" "), source }];
    });
}

export function classifyCronCommand(command: string): ExternalScheduleKind {
  const value = command.toLowerCase();
  if (value.includes("backup")) return "backup";
  if (value.includes("restart") || value.includes("systemctl restart")) return "restart";
  return "unknown";
}

export function matchSchedules(serverDir: string, unitName: string, scripts: DiscoveredScript[], entries: CronEntry[]): ExternalSchedule[] {
  const normalizedDir = normalizePath(serverDir);
  return entries
    .filter((entry) => {
      const command = normalizePath(entry.command);
      return command.includes(normalizedDir) || command.includes(unitName) || scripts.some((script) => command.includes(normalizePath(script.path)));
    })
    .map((entry) => ({
      id: stableId(`${serverDir}:${entry.expression}:${entry.command}`),
      kind: classifyCronCommand(entry.command),
      expression: entry.expression,
      command: entry.command,
      source: entry.source,
      readOnly: true
    }));
}

export async function discoverSystemdUnits(): Promise<UnitInfo[]> {
  if (config.mockCommands) return [];
  const listed = await listCandidateUnitNames();
  const units = await Promise.all(listed.map(readUnitInfo));
  return units.filter((unit): unit is UnitInfo => Boolean(unit));
}

async function listCandidateUnitNames() {
  const result = await runCommand("systemctl", ["list-units", "--type=service", "--all", "--no-legend", "--plain"], 20_000);
  if (result.code !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter((name) => name?.endsWith(".service"))
    .filter((name) => name.toLowerCase().includes("minecraft") || name.toLowerCase().includes("mc"));
}

async function readUnitInfo(unitName: string): Promise<UnitInfo | undefined> {
  try {
    assertServiceName(unitName);
    const show = await runCommand("systemctl", ["show", unitName, "--property=Id,Description,WorkingDirectory,ExecStart,FragmentPath", "--no-pager"], 20_000);
    if (show.code !== 0) return undefined;
    const fields = Object.fromEntries(
      show.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index), line.slice(index + 1)];
        })
    );
    const fragmentPath = fields.FragmentPath;
    const content = fragmentPath && fs.existsSync(fragmentPath) ? fs.readFileSync(fragmentPath, "utf8") : undefined;
    return {
      unitName,
      description: fields.Description,
      workingDirectory: fields.WorkingDirectory || undefined,
      execStart: fields.ExecStart || undefined,
      fragmentPath: fragmentPath || undefined,
      content
    };
  } catch {
    return undefined;
  }
}

async function readCrontab() {
  if (config.mockCommands) return "";
  const args = config.crontabUser ? ["-u", config.crontabUser, "-l"] : ["-l"];
  const result = await runCommand("crontab", args, 15_000);
  return result.code === 0 ? result.stdout : "";
}

function scriptInfo(scriptPath: string, serverDir: string): DiscoveredScript {
  const name = path.basename(scriptPath);
  const kind = scriptKind(name);
  const base = { id: stableId(scriptPath), name: readableScriptName(name), kind, path: scriptPath };
  const resolvedServer = path.resolve(serverDir);
  const resolvedScript = path.resolve(scriptPath);
  if (!resolvedScript.startsWith(resolvedServer + path.sep)) {
    return { ...base, safe: false, reason: "Script is outside the server folder." };
  }
  const stat = fs.statSync(resolvedScript);
  if (process.platform !== "win32" && (stat.mode & 0o002) !== 0) return { ...base, safe: false, reason: "Script is world-writable." };
  if (config.expectedScriptUid !== undefined && stat.uid !== 0 && stat.uid !== config.expectedScriptUid) {
    return { ...base, safe: false, reason: "Script owner is not root or the configured server owner." };
  }
  return { ...base, safe: true };
}

function readPort(filePath: string) {
  if (!fs.existsSync(filePath)) return 25565;
  const line = fs.readFileSync(filePath, "utf8").split(/\r?\n/).find((item) => item.startsWith("server-port="));
  return line ? Number(line.split("=")[1]) || 25565 : 25565;
}

function isLikelyScript(name: string) {
  const lower = name.toLowerCase();
  return lower.endsWith(".sh") && /(^|[._-])(backup|restart|start|stop)([._-]|$)/.test(lower);
}

function scriptKind(name: string): ServerActionKind {
  const lower = name.toLowerCase();
  if (lower.includes("backup")) return "backup";
  if (lower.includes("restart")) return "restart";
  if (lower.includes("start")) return "start";
  if (lower.includes("stop")) return "stop";
  return "custom";
}

function readableScriptName(name: string) {
  return name.replace(/\.sh$/i, "").replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function unitText(unit: UnitInfo) {
  return normalizePath([unit.workingDirectory, unit.execStart, unit.fragmentPath, unit.content].filter(Boolean).join("\n"));
}

function mentionsAnyServerRoot(unit: UnitInfo, serverRoot: string) {
  return unitText(unit).includes(normalizePath(serverRoot));
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/\/+$/g, "");
}

function stableId(value: string) {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 16);
}
