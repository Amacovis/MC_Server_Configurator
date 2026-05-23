import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const config = {
  rootDir,
  port: Number(process.env.MCSC_PORT ?? 4174),
  host: process.env.MCSC_HOST ?? "0.0.0.0",
  dataDir: process.env.MCSC_DATA_DIR ?? path.join(rootDir, "data"),
  serverRoot: process.env.MCSC_SERVER_ROOT ?? "/home/amacovis/Desktop/minecraft",
  backupRoot: process.env.MCSC_BACKUP_ROOT ?? "/opt/minecraft/backups",
  crontabUser: process.env.MCSC_CRONTAB_USER ?? process.env.USER ?? "amacovis",
  expectedScriptUid: process.env.MCSC_EXPECTED_SCRIPT_UID ? Number(process.env.MCSC_EXPECTED_SCRIPT_UID) : undefined,
  sudo: process.env.MCSC_USE_SUDO !== "false",
  mockCommands: process.env.MCSC_MOCK_COMMANDS === "true" || process.platform !== "linux",
  sessionCookie: process.env.MCSC_SESSION_COOKIE ?? "mcsc_session",
  sessionSecret: process.env.MCSC_SESSION_SECRET ?? "change-this-before-lan-use",
  initialAdmin: process.env.MCSC_INITIAL_ADMIN ?? "admin",
  initialPassword: process.env.MCSC_INITIAL_PASSWORD ?? "admin1234"
};
