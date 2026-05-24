import path from "node:path";
import { config } from "./config.js";

const servicePattern = /^[A-Za-z0-9@_.-]+\.service$/;
const namePattern = /^[A-Za-z0-9][A-Za-z0-9 _.-]{1,63}$/;
const logFilePattern = /^[A-Za-z0-9][A-Za-z0-9_. -]{0,127}(?:\.log|\.txt|\.gz)$/;

export const editableFiles = [
  { key: "serverProperties", label: "server.properties", relativePath: "server.properties", language: "properties" as const },
  { key: "ops", label: "ops.json", relativePath: "ops.json", language: "json" as const },
  { key: "whitelist", label: "whitelist.json", relativePath: "whitelist.json", language: "json" as const },
  { key: "bannedPlayers", label: "banned-players.json", relativePath: "banned-players.json", language: "json" as const },
  { key: "forgeConfig", label: "Forge common config", relativePath: "config/forge-common.toml", language: "text" as const }
];

export function assertServiceName(value: string) {
  if (!servicePattern.test(value) || value.includes("..")) {
    throw new Error("Invalid systemd service name");
  }
  return value;
}

export function assertDisplayName(value: string) {
  if (!namePattern.test(value.trim())) {
    throw new Error("Use a 2-64 character server name with letters, numbers, spaces, dots, dashes, or underscores.");
  }
  return value.trim();
}

export function assertPort(port: number) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Port must be an integer between 1024 and 65535.");
  }
  return port;
}

export function assertMemory(memoryMb: number) {
  if (!Number.isInteger(memoryMb) || memoryMb < 512 || memoryMb > 131072) {
    throw new Error("Memory must be between 512 MB and 128 GB.");
  }
  return memoryMb;
}

export function assertJavaArgs(value: string) {
  if (value.length > 512 || /[;&|`$<>]/.test(value)) {
    throw new Error("Java args contain unsupported shell characters.");
  }
  return value.trim();
}

export function resolveServerPath(serverDir: string, relativePath = ".") {
  const root = path.resolve(config.serverRoot);
  const resolvedServer = path.resolve(serverDir);
  const resolved = path.resolve(resolvedServer, relativePath);
  if (!resolvedServer.startsWith(root) || !resolved.startsWith(resolvedServer)) {
    throw new Error("Path is outside the configured Minecraft server root.");
  }
  return resolved;
}

export function editableFileForKey(key: string) {
  const file = editableFiles.find((item) => item.key === key);
  if (!file) throw new Error("File is not in the editable allowlist.");
  return file;
}

export function assertLogFileName(value: string) {
  if (!logFilePattern.test(value) || value.includes("..") || value.includes("/") || value.includes("\\")) {
    throw new Error("Invalid log file name.");
  }
  return value;
}

export function serviceNameForServerName(name: string) {
  const slug = assertDisplayName(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `minecraft-${slug}.service`;
}
