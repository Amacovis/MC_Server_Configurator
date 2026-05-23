import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { config } from "./config.js";

export type Db = DatabaseSync;

export function openDb(dbPath = path.join(config.dataDir, "mcsc.sqlite")) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  seedAdmin(db);
  return db;
}

function migrate(db: Db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      directory TEXT NOT NULL UNIQUE,
      unit_name TEXT NOT NULL UNIQUE,
      port INTEGER NOT NULL,
      memory_mb INTEGER NOT NULL,
      java_args TEXT NOT NULL,
      modpack_provider TEXT,
      modpack_id TEXT,
      modpack_name TEXT,
      rcon_enabled INTEGER NOT NULL DEFAULT 0,
      backup_mode TEXT NOT NULL DEFAULT 'online',
      backup_cron TEXT NOT NULL DEFAULT '0 4 * * *',
      backup_retention INTEGER NOT NULL DEFAULT 7,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backups (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      path TEXT,
      message TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      step TEXT NOT NULL,
      progress INTEGER NOT NULL,
      message TEXT,
      server_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

function seedAdmin(db: Db) {
  const row = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  if (row.count > 0) return;

  const now = new Date().toISOString();
  db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)").run(
    nanoid(),
    config.initialAdmin,
    bcrypt.hashSync(config.initialPassword, 12),
    now
  );
}

export function audit(db: Db, actor: string, action: string, target: string, detail?: unknown) {
  db.prepare("INSERT INTO audit_events (id, actor, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    nanoid(),
    actor,
    action,
    target,
    detail === undefined ? null : JSON.stringify(detail),
    new Date().toISOString()
  );
}

