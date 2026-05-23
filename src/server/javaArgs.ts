import fs from "node:fs";
import path from "node:path";
import type { JavaArgsDiscovery } from "../shared/types.js";
import type { UnitInfo } from "./discovery.js";

const userJvmFile = "user_jvm_args.txt";
const launchScriptNames = ["run.sh", "start.sh", "start_server.sh", "serverstart.sh"];

export function discoverJavaArgs(serverDir: string, unit?: UnitInfo): JavaArgsDiscovery {
  const userJvmPath = path.join(serverDir, userJvmFile);
  if (fs.existsSync(userJvmPath)) {
    const javaArgs = parseUserJvmArgs(fs.readFileSync(userJvmPath, "utf8"));
    return withMemory({
      javaArgs,
      sourceType: "user_jvm_args",
      sourcePath: userJvmPath,
      editable: true
    });
  }

  for (const scriptPath of candidateLaunchScripts(serverDir)) {
    const parsed = parseLaunchCommand(fs.readFileSync(scriptPath, "utf8"), serverDir);
    if (parsed) {
      return withMemory({
        javaArgs: parsed.javaArgs,
        sourceType: "script",
        sourcePath: parsed.sourcePath ?? scriptPath,
        editable: parsed.sourcePath?.endsWith(userJvmFile) ?? false
      });
    }
  }

  const parsedSystemd = unit?.execStart ? parseLaunchCommand(unit.execStart, serverDir) : undefined;
  if (parsedSystemd) {
    return withMemory({
      javaArgs: parsedSystemd.javaArgs,
      sourceType: "systemd",
      sourcePath: parsedSystemd.sourcePath,
      editable: parsedSystemd.sourcePath?.endsWith(userJvmFile) ?? false
    });
  }

  return {
    javaArgs: "-Xms1G",
    sourceType: "default",
    editable: false,
    memoryMb: undefined
  };
}

export function parseUserJvmArgs(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .join(" ");
}

export function parseLaunchCommand(content: string, serverDir = ".") {
  const normalized = content.replace(/\\\r?\n/g, " ");
  const userJvmRef = normalized.match(/@(["']?)([^"'\s]*user_jvm_args\.txt)\1/);
  if (userJvmRef) {
    const refPath = path.resolve(serverDir, userJvmRef[2]);
    if (fs.existsSync(refPath)) {
      return { javaArgs: parseUserJvmArgs(fs.readFileSync(refPath, "utf8")), sourcePath: refPath };
    }
    return { javaArgs: `@${userJvmRef[2]}`, sourcePath: refPath };
  }

  const javaLine = normalized
    .split(/\r?\n|;/)
    .map((line) => line.trim())
    .find((line) => /\bjava\b/.test(line) && /(^|\s)(-X|-XX:|-D|@)/.test(line));

  if (!javaLine) return undefined;
  const tokens = tokenizeShellLike(javaLine);
  const javaIndex = tokens.findIndex((token) => token === "java" || token.endsWith("/java"));
  const args = tokens.slice(javaIndex + 1).filter(isJvmArg);
  return args.length > 0 ? { javaArgs: args.join(" ") } : undefined;
}

export function deriveMemoryMb(javaArgs: string) {
  const match = javaArgs.match(/(?:^|\s)-Xmx(\d+)([gGmMkK]?)(?=\s|$)/);
  if (!match) return undefined;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (!Number.isFinite(value) || value <= 0) return undefined;
  if (unit === "g") return value * 1024;
  if (unit === "k") return Math.round(value / 1024);
  return value;
}

export function writeUserJvmArgs(filePath: string, javaArgs: string, memoryMb: number) {
  const lines = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8").split(/\r?\n/) : [];
  let replacedXmx = false;
  const updated = lines.map((line) => {
    if (/^\s*#/.test(line)) return line;
    if (/(^|\s)-Xmx\d+[gGmMkK]?(\s|$)/.test(line)) {
      replacedXmx = true;
      return line.replace(/-Xmx\d+[gGmMkK]?/, `-Xmx${memoryMb}M`);
    }
    return line;
  });

  const merged = javaArgs
    .split(/\s+/)
    .filter(Boolean)
    .map((arg) => (/^-Xmx/i.test(arg) ? `-Xmx${memoryMb}M` : arg));

  if (updated.length === 0 || !updated.some((line) => line.trim() && !line.trim().startsWith("#"))) {
    fs.writeFileSync(filePath, `${merged.join("\n")}\n`, "utf8");
    return;
  }

  if (!replacedXmx && memoryMb > 0) {
    updated.push(`-Xmx${memoryMb}M`);
  }

  const nonCommentArgs = new Set(merged.filter((arg) => !/^-Xmx/i.test(arg)));
  for (const arg of nonCommentArgs) {
    if (!updated.some((line) => line.trim() === arg)) updated.push(arg);
  }

  fs.writeFileSync(filePath, `${updated.join("\n").replace(/\n+$/g, "")}\n`, "utf8");
}

function candidateLaunchScripts(serverDir: string) {
  const explicit = launchScriptNames.map((name) => path.join(serverDir, name));
  const discovered = fs.existsSync(serverDir)
    ? fs
        .readdirSync(serverDir)
        .filter((name) => name.endsWith(".sh") && /start|run|server/i.test(name))
        .map((name) => path.join(serverDir, name))
    : [];
  return Array.from(new Set([...explicit, ...discovered])).filter((item) => fs.existsSync(item));
}

function withMemory(discovery: Omit<JavaArgsDiscovery, "memoryMb">): JavaArgsDiscovery {
  return { ...discovery, memoryMb: deriveMemoryMb(discovery.javaArgs) };
}

function isJvmArg(token: string) {
  return token.startsWith("-X") || token.startsWith("-XX:") || token.startsWith("-D") || token.startsWith("@");
}

function tokenizeShellLike(value: string) {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) tokens.push(match[1] ?? match[2] ?? match[3]);
  return tokens;
}

