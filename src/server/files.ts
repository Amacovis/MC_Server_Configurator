import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { assertLogFileName, editableFileForKey, resolveServerPath } from "./security.js";
import type { ServerLogFile } from "../shared/types.js";

const maxPlainLogBytes = 512_000;
const maxCompressedLogBytes = 5_000_000;

export function readEditableFile(serverDir: string, key: string) {
  const file = editableFileForKey(key);
  const path = resolveServerPath(serverDir, file.relativePath);
  return {
    ...file,
    content: fs.existsSync(path) ? fs.readFileSync(path, "utf8") : ""
  };
}

export function writeEditableFile(serverDir: string, key: string, content: string) {
  const file = editableFileForKey(key);
  if (content.length > 512_000) throw new Error("File content is too large.");
  if (file.language === "json" && content.trim()) JSON.parse(content);
  const filePath = resolveServerPath(serverDir, file.relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
  return readEditableFile(serverDir, key);
}

export function listLogFiles(serverDir: string): ServerLogFile[] {
  const logsDir = resolveServerPath(serverDir, "logs");
  if (!fs.existsSync(logsDir)) return [];
  return fs
    .readdirSync(logsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .filter((entry) => {
      try {
        assertLogFileName(entry.name);
        return true;
      } catch {
        return false;
      }
    })
    .map((entry) => {
      const filePath = resolveServerPath(serverDir, path.join("logs", entry.name));
      const stat = fs.statSync(filePath);
      return {
        name: entry.name,
        relativePath: path.join("logs", entry.name).replace(/\\/g, "/"),
        size: stat.size,
        modifiedAt: stat.mtime.toISOString()
      };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

export function readLogFile(serverDir: string, name: string) {
  const safeName = assertLogFileName(name);
  const filePath = resolveServerPath(serverDir, path.join("logs", safeName));
  const stat = fs.statSync(filePath);
  const base = {
    name: safeName,
    relativePath: path.join("logs", safeName).replace(/\\/g, "/"),
    size: stat.size,
    modifiedAt: stat.mtime.toISOString()
  };

  if (safeName.endsWith(".gz")) {
    if (stat.size > maxCompressedLogBytes) {
      throw new Error("Compressed log is too large to preview.");
    }
    const content = zlib.gunzipSync(fs.readFileSync(filePath)).toString("utf8");
    return {
      ...base,
      content: content.length > maxPlainLogBytes ? content.slice(-maxPlainLogBytes) : content,
      truncated: content.length > maxPlainLogBytes
    };
  }

  const start = Math.max(0, stat.size - maxPlainLogBytes);
  const buffer = Buffer.alloc(stat.size - start);
  const handle = fs.openSync(filePath, "r");
  try {
    fs.readSync(handle, buffer, 0, buffer.length, start);
  } finally {
    fs.closeSync(handle);
  }
  return {
    ...base,
    content: buffer.toString("utf8"),
    truncated: start > 0
  };
}
