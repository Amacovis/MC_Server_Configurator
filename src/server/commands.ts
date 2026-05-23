import { spawn } from "node:child_process";
import { config } from "./config.js";
import { assertServiceName } from "./security.js";

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function systemctlArgs(action: "start" | "stop" | "restart" | "is-active", unitName: string) {
  return ["systemctl", action, assertServiceName(unitName)];
}

export function journalctlArgs(unitName: string, lines = 200) {
  const safeLines = Math.min(Math.max(lines, 1), 1000);
  return ["journalctl", "-u", assertServiceName(unitName), "-n", String(safeLines), "--no-pager", "--output", "short-iso"];
}

export async function runCommand(command: string, args: string[], timeoutMs = 30_000): Promise<CommandResult> {
  if (config.mockCommands) {
    return { stdout: mockOutput(command, args), stderr: "", code: 0 };
  }

  const resolvedCommand = resolveCommand(command);
  const executable = config.sudo ? "sudo" : resolvedCommand;
  const finalArgs = config.sudo ? [resolvedCommand, ...args] : args;

  return new Promise((resolve, reject) => {
    const child = spawn(executable, finalArgs, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Command timed out: ${command}`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

export function resolveCommand(command: string) {
  if (command.includes("/") || process.platform !== "linux") return command;
  const paths: Record<string, string> = {
    systemctl: "/usr/bin/systemctl",
    journalctl: "/usr/bin/journalctl",
    tar: "/usr/bin/tar",
    crontab: "/usr/bin/crontab",
    "mcsc-rcon": "/usr/local/bin/mcsc-rcon"
  };
  return paths[command] ?? command;
}

function mockOutput(command: string, args: string[]) {
  if (command === "systemctl" && args[0] === "is-active") return "inactive\n";
  if (command === "journalctl") return "2026-05-23T12:00:00 mock minecraft server log line\n";
  return `mocked ${command} ${args.join(" ")}\n`;
}
