import fs from "node:fs";
import path from "node:path";
import express from "express";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import { audit, type Db } from "./db.js";
import { authHandlers, requireAuth } from "./auth.js";
import { runBackup, validateCron } from "./backups.js";
import { runCommand } from "./commands.js";
import { buildImportPreview, discoverSystemdUnits } from "./discovery.js";
import { listLogFiles, readEditableFile, readLogFile, writeEditableFile } from "./files.js";
import { discoverJavaArgs, writeUserJvmArgs } from "./javaArgs.js";
import { getVersions, searchModpacks } from "./modpacks.js";
import { assertDisplayName, assertJavaArgs, assertMemory, assertPort, editableFiles, resolveServerPath, serviceNameForServerName } from "./security.js";
import { assertServiceName } from "./security.js";
import { controlServer, discoverCandidateServices, getLogs, listServers, mapServer, testService } from "./systemd.js";
import type { CreateServerRequest, ImportSelection, ServerSettingsInput } from "../shared/types.js";

export function createRouter(db: Db) {
  const router = express.Router();
  const auth = authHandlers(db);

  router.post("/auth/login", auth.login);
  router.post("/auth/logout", auth.logout);
  router.get("/auth/me", requireAuth(db), auth.me);

  router.use(requireAuth(db));

  router.get("/servers", async (_req, res, next) => {
    try {
      res.json(await listServers(db));
    } catch (error) {
      next(error);
    }
  });

  router.get("/servers/import/preview", async (_req, res, next) => {
    try {
      res.json(await buildImportPreview(existingImportKeys(db)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/servers/import", async (req, res, next) => {
    try {
      const selections = normalizeImportSelections(req.body);
      const preview = await buildImportPreview(existingImportKeys(db), new Map(Array.from(selections ?? []).flatMap(([id, unitName]) => unitName ? [[id, unitName]] : [])));
      const candidates = preview.items.filter((item) => !selections || selections.has(item.id));
      const now = new Date().toISOString();
      let imported = 0;
      for (const candidate of candidates) {
        const existing = db.prepare("SELECT id FROM servers WHERE directory = ? OR unit_name = ?").get(candidate.directory, candidate.unitName);
        if (existing) continue;
        const unitName = assertServiceName(selections?.get(candidate.id) ?? candidate.unitName);
        const insertServer = db.prepare(
          `INSERT INTO servers
           (id, name, directory, unit_name, port, memory_mb, java_args, java_args_source_type, java_args_source_path, java_args_editable,
            rcon_enabled, backup_mode, backup_cron, backup_retention, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'online', '0 4 * * *', 7, ?, ?)`
        );
        const serverId = nanoid();
        insertServer.run(
          serverId,
          candidate.name,
          candidate.directory,
          unitName,
          candidate.port,
          candidate.memoryMb,
          candidate.javaArgs,
          candidate.javaArgsSourceType,
          candidate.javaArgsSourcePath ?? null,
          candidate.javaArgsEditable ? 1 : 0,
          now,
          now
        );
        persistDiscoveredActions(db, serverId, candidate.scripts, now);
        persistExternalSchedules(db, serverId, candidate.externalSchedules, now);
        imported += 1;
      }
      audit(db, req.user!.username, "servers.import", "servers", { imported });
      res.json({ imported, servers: await listServers(db) });
    } catch (error) {
      next(error);
    }
  });

  router.post("/servers/create", (req, res, next) => {
    try {
      const body = req.body as CreateServerRequest;
      const name = assertDisplayName(body.name);
      const port = assertPort(Number(body.port));
      const memoryMb = assertMemory(Number(body.memoryMb));
      const javaArgs = assertJavaArgs(body.javaArgs ?? "");
      if (!body.acceptEula) throw new Error("You must confirm the Minecraft EULA before creating a server.");

      const jobId = nanoid();
      const now = new Date().toISOString();
      db.prepare("INSERT INTO jobs (id, status, step, progress, message, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
        jobId,
        body.provider === "curseforge" ? "manual_required" : "queued",
        body.provider === "curseforge" ? "Manual server pack required" : "Queued",
        body.provider === "curseforge" ? 10 : 0,
        body.provider === "curseforge" ? "CurseForge installs require uploading the server pack in v1." : "Install job created.",
        now,
        now
      );

      if (body.provider !== "curseforge") {
        void createServerFromJob(db, jobId, {
          name,
          port,
          memoryMb,
          javaArgs,
          provider: body.provider,
          modpackId: body.modpackId,
          modpackName: body.modpackName,
          versionId: body.versionId
        }).catch((error) => {
          db.prepare("UPDATE jobs SET status = ?, step = ?, message = ?, updated_at = ? WHERE id = ?").run(
            "failed",
            "Failed",
            error instanceof Error ? error.message : "Install failed.",
            new Date().toISOString(),
            jobId
          );
        });
      }

      audit(db, req.user!.username, "servers.create", name, { jobId });
      res.status(202).json({ id: jobId });
    } catch (error) {
      next(error);
    }
  });

  router.post("/servers/:id/:action", async (req, res, next) => {
    try {
      const server = getServer(db, req.params.id);
      const action = req.params.action as "start" | "stop" | "restart";
      if (!["start", "stop", "restart"].includes(action)) throw new Error("Unsupported server action.");
      await controlServer(server.unitName, action);
      audit(db, req.user!.username, `servers.${action}`, server.name);
      res.json({ ok: true });
    } catch (error) {
      audit(db, req.user?.username ?? "unknown", "servers.control_failed", req.params.id, { error: String(error) });
      next(error);
    }
  });

  router.delete("/servers/:id", (req, res, next) => {
    try {
      const server = getServer(db, req.params.id);
      db.prepare("UPDATE jobs SET server_id = NULL WHERE server_id = ?").run(server.id);
      db.prepare("DELETE FROM servers WHERE id = ?").run(server.id);
      audit(db, req.user!.username, "servers.unregister", server.name, {
        id: server.id,
        directory: server.directory,
        unitName: server.unitName,
        filesDeleted: false
      });
      res.json({ ok: true, filesDeleted: false });
    } catch (error) {
      next(error);
    }
  });

  router.get("/servers/:id/logs", async (req, res, next) => {
    try {
      const server = getServer(db, req.params.id);
      res.type("text/plain").send(await getLogs(server.unitName, Number(req.query.lines ?? 200)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/servers/:id/log-files", (req, res, next) => {
    try {
      const server = getServer(db, req.params.id);
      res.json(listLogFiles(server.directory));
    } catch (error) {
      next(error);
    }
  });

  router.get("/servers/:id/log-files/:fileName", (req, res, next) => {
    try {
      const server = getServer(db, req.params.id);
      res.json(readLogFile(server.directory, req.params.fileName));
    } catch (error) {
      next(error);
    }
  });

  router.post("/servers/:id/service/test", async (req, res, next) => {
    try {
      getServer(db, req.params.id);
      const unitName = assertServiceName(String(req.body?.unitName ?? ""));
      res.json(await testService(unitName));
    } catch (error) {
      next(error);
    }
  });

  router.get("/servers/:id/actions", (req, res, next) => {
    try {
      getServer(db, req.params.id);
      res.json(db.prepare("SELECT id, server_id AS serverId, name, kind, script_path AS scriptPath, created_at AS createdAt FROM server_actions WHERE server_id = ? ORDER BY kind, name").all(req.params.id));
    } catch (error) {
      next(error);
    }
  });

  router.post("/servers/:id/actions/:actionId/run", async (req, res, next) => {
    try {
      const server = getServer(db, req.params.id);
      const action = db.prepare("SELECT * FROM server_actions WHERE id = ? AND server_id = ?").get(req.params.actionId, server.id) as
        | { id: string; name: string; kind: string; script_path: string }
        | undefined;
      if (!action) throw new Error("Server action not found.");
      const scriptPath = resolveServerPath(server.directory, path.relative(server.directory, action.script_path));
      const result = await runCommand(scriptPath, [], 120_000);
      audit(db, req.user!.username, "servers.action_run", server.name, { action: action.name, code: result.code });
      if (result.code !== 0) throw new Error(result.stderr || `${action.name} failed.`);
      res.json({ ok: true, stdout: result.stdout, stderr: result.stderr });
    } catch (error) {
      audit(db, req.user?.username ?? "unknown", "servers.action_failed", req.params.id, { actionId: req.params.actionId, error: String(error) });
      next(error);
    }
  });

  router.get("/servers/:id/settings", (req, res, next) => {
    try {
      res.json(mapServer(getServerRow(db, req.params.id)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/servers/:id/java-args/refresh", async (req, res, next) => {
    try {
      const server = getServer(db, req.params.id);
      const unit = (await discoverSystemdUnits()).find((item) => item.unitName === server.unitName) ?? { unitName: server.unitName };
      const discovery = discoverJavaArgs(server.directory, unit);
      db.prepare(
        `UPDATE servers SET java_args = ?, memory_mb = ?, java_args_source_type = ?, java_args_source_path = ?,
         java_args_editable = ?, updated_at = ? WHERE id = ?`
      ).run(
        discovery.javaArgs,
        discovery.memoryMb ?? server.memoryMb,
        discovery.sourceType,
        discovery.sourcePath ?? null,
        discovery.editable ? 1 : 0,
        new Date().toISOString(),
        server.id
      );
      audit(db, req.user!.username, "servers.java_args_refresh", server.name, discovery);
      res.json(mapServer(getServerRow(db, server.id)));
    } catch (error) {
      next(error);
    }
  });

  router.put("/servers/:id/settings", (req, res, next) => {
    try {
      const existing = getServer(db, req.params.id);
      const body = req.body as ServerSettingsInput;
      const updated = {
        name: assertDisplayName(body.name),
        unitName: assertServiceName(body.unitName),
        port: assertPort(Number(body.port)),
        memoryMb: assertMemory(Number(body.memoryMb)),
        javaArgs: assertJavaArgs(body.javaArgs ?? ""),
        rconEnabled: Boolean(body.rconEnabled),
        backupMode: body.backupMode === "stop_then_backup" ? "stop_then_backup" : "online",
        backupCron: validateCron(body.backupCron),
        backupRetention: Math.min(Math.max(Number(body.backupRetention) || 7, 1), 90)
      };
      if (existing.javaArgsEditable && existing.javaArgsSourcePath) {
        const sourcePath = resolveServerPath(existing.directory, path.relative(existing.directory, existing.javaArgsSourcePath));
        writeUserJvmArgs(sourcePath, updated.javaArgs, updated.memoryMb);
      }
      db.prepare(
        `UPDATE servers SET name = ?, unit_name = ?, port = ?, memory_mb = ?, java_args = ?, rcon_enabled = ?, backup_mode = ?,
         backup_cron = ?, backup_retention = ?, updated_at = ? WHERE id = ?`
      ).run(
        updated.name,
        updated.unitName,
        updated.port,
        updated.memoryMb,
        updated.javaArgs,
        updated.rconEnabled ? 1 : 0,
        updated.backupMode,
        updated.backupCron,
        updated.backupRetention,
        new Date().toISOString(),
        existing.id
      );
      audit(db, req.user!.username, "servers.settings_update", existing.name, { ...updated, previousUnitName: existing.unitName });
      res.json(mapServer(getServerRow(db, existing.id)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/servers/:id/files", (req, res, next) => {
    try {
      getServer(db, req.params.id);
      res.json(editableFiles);
    } catch (error) {
      next(error);
    }
  });

  router.get("/servers/:id/files/:fileKey", (req, res, next) => {
    try {
      const server = getServer(db, req.params.id);
      res.json(readEditableFile(server.directory, req.params.fileKey));
    } catch (error) {
      next(error);
    }
  });

  router.put("/servers/:id/files/:fileKey", (req, res, next) => {
    try {
      const server = getServer(db, req.params.id);
      const result = writeEditableFile(server.directory, req.params.fileKey, String(req.body?.content ?? ""));
      audit(db, req.user!.username, "servers.file_update", server.name, { fileKey: req.params.fileKey });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get("/servers/:id/backups/schedule", (req, res, next) => {
    try {
      const server = getServer(db, req.params.id);
      res.json({ backupMode: server.backupMode, backupCron: server.backupCron, backupRetention: server.backupRetention });
    } catch (error) {
      next(error);
    }
  });

  router.put("/servers/:id/backups/schedule", (req, res, next) => {
    try {
      const server = getServer(db, req.params.id);
      const backupCron = validateCron(String(req.body?.backupCron ?? server.backupCron));
      const backupMode = req.body?.backupMode === "stop_then_backup" ? "stop_then_backup" : "online";
      const backupRetention = Math.min(Math.max(Number(req.body?.backupRetention) || server.backupRetention, 1), 90);
      db.prepare("UPDATE servers SET backup_mode = ?, backup_cron = ?, backup_retention = ?, updated_at = ? WHERE id = ?").run(
        backupMode,
        backupCron,
        backupRetention,
        new Date().toISOString(),
        server.id
      );
      audit(db, req.user!.username, "servers.backup_schedule_update", server.name, { backupMode, backupCron, backupRetention });
      res.json({ backupMode, backupCron, backupRetention });
    } catch (error) {
      next(error);
    }
  });

  router.post("/servers/:id/backups/run", async (req, res, next) => {
    try {
      const server = getServer(db, req.params.id);
      const backup = await runBackup(db, server);
      audit(db, req.user!.username, "servers.backup_run", server.name, backup);
      res.status(202).json(backup);
    } catch (error) {
      next(error);
    }
  });

  router.get("/servers/:id/backups", (req, res, next) => {
    try {
      getServer(db, req.params.id);
      res.json(db.prepare("SELECT * FROM backups WHERE server_id = ? ORDER BY created_at DESC LIMIT 50").all(req.params.id));
    } catch (error) {
      next(error);
    }
  });

  router.get("/servers/:id/external-schedules", (req, res, next) => {
    try {
      getServer(db, req.params.id);
      res.json(
        db
          .prepare(
            `SELECT id, server_id AS serverId, kind, expression, command, source, read_only AS readOnly, created_at AS createdAt
             FROM external_schedules WHERE server_id = ? ORDER BY kind, expression`
          )
          .all(req.params.id)
      );
    } catch (error) {
      next(error);
    }
  });

  router.get("/modpacks/search", async (req, res, next) => {
    try {
      res.json(await searchModpacks(String(req.query.q ?? "")));
    } catch (error) {
      next(error);
    }
  });

  router.get("/modpacks/:provider/:id/versions", async (req, res, next) => {
    try {
      res.json(await getVersions(req.params.provider, req.params.id));
    } catch (error) {
      next(error);
    }
  });

  router.get("/jobs/:id", (req, res, next) => {
    try {
      const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(req.params.id);
      if (!job) return res.status(404).json({ error: "Job not found." });
      res.json(job);
    } catch (error) {
      next(error);
    }
  });

  router.get("/settings", (_req, res) => {
    res.json({
      serverRoot: config.serverRoot,
      backupRoot: config.backupRoot,
      mockCommands: config.mockCommands
    });
  });

  router.get("/systemd/services", async (_req, res, next) => {
    try {
      res.json(await discoverCandidateServices());
    } catch (error) {
      next(error);
    }
  });

  router.get("/audit", (_req, res) => {
    res.json(db.prepare("SELECT * FROM audit_events ORDER BY created_at DESC LIMIT 100").all());
  });

  return router;
}

function getServerRow(db: Db, id: string) {
  const row = db.prepare("SELECT * FROM servers WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) throw new Error("Server not found.");
  return row;
}

function getServer(db: Db, id: string) {
  return mapServer(getServerRow(db, id));
}

function existingImportKeys(db: Db) {
  return db.prepare("SELECT directory, unit_name AS unitName FROM servers").all() as Array<{ directory: string; unitName: string }>;
}

function normalizeImportSelections(body: unknown) {
  const value = body as { selectedIds?: unknown[]; selections?: ImportSelection[] } | undefined;
  if (Array.isArray(value?.selections)) {
    return new Map(value.selections.map((item) => [String(item.id), item.unitName ? assertServiceName(String(item.unitName)) : undefined]));
  }
  if (Array.isArray(value?.selectedIds)) {
    return new Map(value.selectedIds.map((id) => [String(id), undefined]));
  }
  return undefined;
}

function persistDiscoveredActions(db: Db, serverId: string, scripts: Array<{ id: string; name: string; kind: string; path: string; safe: boolean }>, now: string) {
  const insert = db.prepare("INSERT OR IGNORE INTO server_actions (id, server_id, name, kind, script_path, created_at) VALUES (?, ?, ?, ?, ?, ?)");
  for (const script of scripts.filter((item) => item.safe)) {
    insert.run(nanoid(), serverId, script.name, script.kind, script.path, now);
  }
}

function persistExternalSchedules(
  db: Db,
  serverId: string,
  schedules: Array<{ kind: string; expression: string; command: string; source: string; readOnly: boolean }>,
  now: string
) {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO external_schedules (id, server_id, kind, expression, command, source, read_only, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const schedule of schedules) {
    insert.run(nanoid(), serverId, schedule.kind, schedule.expression, schedule.command, schedule.source, schedule.readOnly ? 1 : 0, now);
  }
}

async function createServerFromJob(
  db: Db,
  jobId: string,
  input: { name: string; port: number; memoryMb: number; javaArgs: string; provider: string; modpackId: string; modpackName: string; versionId: string }
) {
  updateJob(db, jobId, "running", "Creating server directory", 20);
  const serverId = nanoid();
  const unitName = serviceNameForServerName(input.name);
  const directory = resolveServerPath(path.join(config.serverRoot, unitName.replace(/^minecraft-/, "").replace(/\.service$/, "")));
  fs.mkdirSync(directory, { recursive: true });

  updateJob(db, jobId, "running", "Writing baseline configuration", 50);
  fs.writeFileSync(path.join(directory, "eula.txt"), "eula=true\n", "utf8");
  fs.writeFileSync(path.join(directory, "server.properties"), `server-port=${input.port}\nenable-rcon=false\n`, "utf8");
  fs.writeFileSync(
    path.join(directory, "README.install.txt"),
    `Modpack ${input.modpackName} (${input.provider}:${input.modpackId}) version ${input.versionId} was selected.\nPlace the downloaded server files here if the platform requires manual extraction.\n`,
    "utf8"
  );

  updateJob(db, jobId, "running", "Registering server", 80);
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO servers
     (id, name, directory, unit_name, port, memory_mb, java_args, java_args_source_type, java_args_source_path, java_args_editable,
      modpack_provider, modpack_id, modpack_name,
      rcon_enabled, backup_mode, backup_cron, backup_retention, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'default', NULL, 0, ?, ?, ?, 0, 'online', '0 4 * * *', 7, ?, ?)`
  ).run(serverId, input.name, directory, unitName, input.port, input.memoryMb, input.javaArgs, input.provider, input.modpackId, input.modpackName, now, now);

  updateJob(db, jobId, "completed", "Server registered", 100, "Server directory and app registration created.", serverId);
}

function updateJob(db: Db, id: string, status: string, step: string, progress: number, message?: string, serverId?: string) {
  db.prepare("UPDATE jobs SET status = ?, step = ?, progress = ?, message = COALESCE(?, message), server_id = COALESCE(?, server_id), updated_at = ? WHERE id = ?").run(
    status,
    step,
    progress,
    message ?? null,
    serverId ?? null,
    new Date().toISOString(),
    id
  );
}
