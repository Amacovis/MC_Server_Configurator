import fs from "node:fs";
import path from "node:path";
import { editableFileForKey, resolveServerPath } from "./security.js";

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
