import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { nanoid } from "nanoid";
import { config } from "./config.js";
import type { Db } from "./db.js";
import type { AuthUser } from "../shared/types.js";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function authHandlers(db: Db) {
  return {
    async login(req: Request, res: Response) {
      const { username, password } = req.body ?? {};
      if (typeof username !== "string" || typeof password !== "string") {
        return res.status(400).json({ error: "Username and password are required." });
      }

      const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
        | { id: string; username: string; password_hash: string }
        | undefined;

      if (!user || !(await bcrypt.compare(password, user.password_hash))) {
        return res.status(401).json({ error: "Invalid username or password." });
      }

      const sessionId = nanoid(48);
      const now = new Date();
      const expires = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 7);
      db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
        sessionId,
        user.id,
        expires.toISOString(),
        now.toISOString()
      );

      res.cookie(config.sessionCookie, sessionId, {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
        expires
      });

      return res.json({ id: user.id, username: user.username });
    },

    logout(req: Request, res: Response) {
      const sessionId = req.cookies?.[config.sessionCookie];
      if (sessionId) db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
      res.clearCookie(config.sessionCookie);
      res.json({ ok: true });
    },

    me(req: Request, res: Response) {
      res.json(req.user ?? null);
    }
  };
}

export function requireAuth(db: Db) {
  return (req: Request, res: Response, next: NextFunction) => {
    const sessionId = req.cookies?.[config.sessionCookie];
    if (!sessionId) return res.status(401).json({ error: "Authentication required." });

    const row = db
      .prepare(
        `SELECT users.id, users.username, sessions.expires_at
         FROM sessions JOIN users ON users.id = sessions.user_id
         WHERE sessions.id = ?`
      )
      .get(sessionId) as { id: string; username: string; expires_at: string } | undefined;

    if (!row || new Date(row.expires_at) < new Date()) {
      if (row) db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
      return res.status(401).json({ error: "Authentication required." });
    }

    req.user = { id: row.id, username: row.username };
    return next();
  };
}

