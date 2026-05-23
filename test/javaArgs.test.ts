import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveMemoryMb, discoverJavaArgs, parseLaunchCommand, parseUserJvmArgs, writeUserJvmArgs } from "../src/server/javaArgs";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcsc-jvm-"));
  tempDirs.push(dir);
  return dir;
}

describe("jvm args parsing", () => {
  it("parses user_jvm_args.txt comments and args", () => {
    expect(parseUserJvmArgs("# comment\n-Xmx6G\n\n-Xms2G\n-XX:+UseG1GC\n-Dfoo=bar\n")).toBe("-Xmx6G -Xms2G -XX:+UseG1GC -Dfoo=bar");
  });

  it("parses launch scripts with java args", () => {
    const parsed = parseLaunchCommand('java -Xmx6144M -Xms2G -XX:+UseG1GC -jar server.jar nogui');
    expect(parsed?.javaArgs).toBe("-Xmx6144M -Xms2G -XX:+UseG1GC");
  });

  it("follows @user_jvm_args.txt references", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "user_jvm_args.txt"), "-Xmx8G\n-Xms4G\n");
    const parsed = parseLaunchCommand("java @user_jvm_args.txt @libraries/net/minecraftforge/unix_args.txt nogui", dir);
    expect(parsed?.javaArgs).toBe("-Xmx8G -Xms4G");
    expect(parsed?.sourcePath).toBe(path.join(dir, "user_jvm_args.txt"));
  });

  it("derives memory from Xmx values", () => {
    expect(deriveMemoryMb("-Xmx6G")).toBe(6144);
    expect(deriveMemoryMb("-Xmx6144M")).toBe(6144);
    expect(deriveMemoryMb("-Xmx1048576K")).toBe(1024);
    expect(deriveMemoryMb("-Xms1G")).toBeUndefined();
  });

  it("prefers user_jvm_args over scripts and systemd", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "user_jvm_args.txt"), "-Xmx6G\n");
    fs.writeFileSync(path.join(dir, "run.sh"), "java -Xmx2G -jar server.jar");

    const discovery = discoverJavaArgs(dir, { unitName: "minecraft.service", execStart: "java -Xmx1G -jar server.jar" });

    expect(discovery.sourceType).toBe("user_jvm_args");
    expect(discovery.javaArgs).toBe("-Xmx6G");
    expect(discovery.memoryMb).toBe(6144);
    expect(discovery.editable).toBe(true);
  });

  it("writes editable user_jvm_args and aligns Xmx", () => {
    const dir = tempDir();
    const file = path.join(dir, "user_jvm_args.txt");
    fs.writeFileSync(file, "# keep\n-Xmx4G\n-Xms2G\n");

    writeUserJvmArgs(file, "-Xmx8G -Xms2G -XX:+UseG1GC", 8192);

    expect(fs.readFileSync(file, "utf8")).toContain("-Xmx8192M");
    expect(fs.readFileSync(file, "utf8")).toContain("-XX:+UseG1GC");
  });
});

