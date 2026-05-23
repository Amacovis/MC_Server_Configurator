import path from "node:path";
import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import { config } from "./config.js";
import { openDb } from "./db.js";
import { createRouter } from "./routes.js";

const app = express();
const db = openDb();

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser(config.sessionSecret));
app.use("/api", createRouter(db));

const clientDir = path.join(config.rootDir, "dist/client");
app.use(express.static(clientDir));
app.use((_req, res) => {
  res.sendFile(path.join(clientDir, "index.html"));
});

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const message = error instanceof Error ? error.message : "Unexpected error.";
  res.status(message.includes("not found") ? 404 : 400).json({ error: message });
});

app.listen(config.port, config.host, () => {
  console.log(`Minecraft Server Configurator listening on http://${config.host}:${config.port}`);
  if (config.mockCommands) console.log("Command execution is in mock mode.");
});
