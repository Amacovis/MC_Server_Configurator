import { describe, expect, it } from "vitest";
import { getStatus, mapServer } from "../src/server/systemd";

describe("server row mapping", () => {
  it("maps database rows to UI server records", () => {
    const server = mapServer({
      id: "1",
      name: "Survival",
      directory: "/opt/minecraft/servers/survival",
      unit_name: "minecraft-survival.service",
      port: 25565,
      memory_mb: 4096,
      java_args: "-Xmx4G",
      rcon_enabled: 1,
      backup_mode: "online",
      backup_cron: "0 4 * * *",
      backup_retention: 7,
      created_at: "now",
      updated_at: "now"
    }, "running");

    expect(server.status).toBe("running");
    expect(server.unitName).toBe("minecraft-survival.service");
    expect(server.rconEnabled).toBe(true);
  });

  it("treats systemd failed state as stopped for Minecraft screen shutdowns", async () => {
    await expect(getStatus("minecraft4.service")).resolves.toBe("stopped");
  });
});
