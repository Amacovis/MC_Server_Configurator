import { describe, expect, it } from "vitest";
import { journalctlArgs, resolveCommand, systemctlArgs } from "../src/server/commands";
import { assertJavaArgs, assertPort, assertServiceName, editableFileForKey, serviceNameForServerName } from "../src/server/security";

describe("command safety", () => {
  it("builds systemctl arguments without shell interpolation", () => {
    expect(systemctlArgs("start", "minecraft-survival.service")).toEqual(["systemctl", "start", "minecraft-survival.service"]);
  });

  it("resolves sudo-controlled commands to sudoers-compatible paths on linux", () => {
    const expected = process.platform === "linux" ? "/usr/bin/systemctl" : "systemctl";
    expect(resolveCommand("systemctl")).toBe(expected);
  });

  it("rejects unsafe service names", () => {
    expect(() => systemctlArgs("stop", "minecraft;reboot.service")).toThrow();
    expect(() => journalctlArgs("../minecraft.service")).toThrow();
  });

  it("accepts numbered minecraft service names", () => {
    expect(assertServiceName("minecraft-service.service")).toBe("minecraft-service.service");
    expect(assertServiceName("minecraft2-service.service")).toBe("minecraft2-service.service");
    expect(assertServiceName("minecraft3-service.service")).toBe("minecraft3-service.service");
    expect(() => assertServiceName("minecraft-service")).toThrow();
    expect(() => assertServiceName("minecraft2-service.service;reboot")).toThrow();
  });

  it("validates ports and java args", () => {
    expect(assertPort(25565)).toBe(25565);
    expect(() => assertPort(22)).toThrow();
    expect(assertJavaArgs("-Xmx4G -Xms1G")).toBe("-Xmx4G -Xms1G");
    expect(() => assertJavaArgs("-Xmx4G; rm -rf /")).toThrow();
  });

  it("limits editable files to known keys", () => {
    expect(editableFileForKey("serverProperties").relativePath).toBe("server.properties");
    expect(() => editableFileForKey("../../shadow")).toThrow();
  });

  it("derives predictable systemd service names", () => {
    expect(serviceNameForServerName("Family SMP")).toBe("minecraft-family-smp.service");
  });
});
