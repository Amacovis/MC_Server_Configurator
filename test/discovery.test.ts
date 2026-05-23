import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classifyCronCommand, discoverScripts, matchFolderToUnit, matchSchedules, parseCrontab } from "../src/server/discovery";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("systemd discovery matching", () => {
  it("matches folders by WorkingDirectory first", () => {
    const match = matchFolderToUnit("/home/amacovis/Desktop/minecraft/survival", [
      { unitName: "survival.service", workingDirectory: "/home/amacovis/Desktop/minecraft/survival" }
    ]);

    expect(match.confidence).toBe("high");
    expect(match.source).toBe("WorkingDirectory");
    expect(match.unit?.unitName).toBe("survival.service");
  });

  it("matches folders by ExecStart path reference", () => {
    const match = matchFolderToUnit("/home/amacovis/Desktop/minecraft/modded", [
      { unitName: "modded.service", execStart: "/usr/bin/java -jar /home/amacovis/Desktop/minecraft/modded/server.jar" }
    ]);

    expect(match.confidence).toBe("high");
    expect(match.source).toBe("unit path reference");
  });

  it("falls back to minecraft folder naming with low confidence", () => {
    const match = matchFolderToUnit("/home/amacovis/Desktop/minecraft/creative", [
      { unitName: "minecraft-creative.service" }
    ]);

    expect(match.confidence).toBe("low");
    expect(match.source).toBe("naming pattern");
  });
});

describe("script discovery", () => {
  it("registers likely scripts inside a server folder", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcsc-"));
    tempDirs.push(dir);
    const script = path.join(dir, "backup.sh");
    fs.writeFileSync(script, "#!/usr/bin/env bash\n");
    fs.chmodSync(script, 0o755);

    const scripts = discoverScripts(dir);

    expect(scripts).toHaveLength(1);
    expect(scripts[0].kind).toBe("backup");
    expect(scripts[0].safe).toBe(true);
  });

  it.skipIf(process.platform === "win32")("rejects world-writable scripts", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcsc-"));
    tempDirs.push(dir);
    const script = path.join(dir, "restart.sh");
    fs.writeFileSync(script, "#!/usr/bin/env bash\n");
    fs.chmodSync(script, 0o777);

    const scripts = discoverScripts(dir);

    expect(scripts[0].safe).toBe(false);
    expect(scripts[0].reason).toContain("world-writable");
  });
});

describe("crontab discovery", () => {
  it("parses cron jobs and ignores comments", () => {
    const entries = parseCrontab(`
      # old job
      SHELL=/bin/bash
      0 4 * * * /home/amacovis/Desktop/minecraft/survival/backup.sh
    `);

    expect(entries).toEqual([
      {
        expression: "0 4 * * *",
        command: "/home/amacovis/Desktop/minecraft/survival/backup.sh",
        source: "user crontab"
      }
    ]);
  });

  it("classifies backup and restart commands", () => {
    expect(classifyCronCommand("/srv/server/backup.sh")).toBe("backup");
    expect(classifyCronCommand("systemctl restart minecraft-survival.service")).toBe("restart");
    expect(classifyCronCommand("/srv/server/check.sh")).toBe("unknown");
  });

  it("matches cron jobs by folder, unit, or script path", () => {
    const schedules = matchSchedules(
      "/home/amacovis/Desktop/minecraft/survival",
      "minecraft-survival.service",
      [{ id: "script", name: "Backup", kind: "backup", path: "/home/amacovis/Desktop/minecraft/survival/backup.sh", safe: true }],
      [
        { expression: "0 4 * * *", command: "/home/amacovis/Desktop/minecraft/survival/backup.sh", source: "user crontab" },
        { expression: "0 5 * * *", command: "systemctl restart minecraft-survival.service", source: "user crontab" },
        { expression: "0 6 * * *", command: "/tmp/other.sh", source: "user crontab" }
      ]
    );

    expect(schedules.map((schedule) => schedule.kind)).toEqual(["backup", "restart"]);
  });
});
