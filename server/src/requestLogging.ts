import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { log } from "./logger";

function truncate(s: string, max = 1200) {
  if (s.length <= max) return s;
  return s.slice(0, max) + `…(+${s.length - max} chars)`;
}

function safeHeaders(headers: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers)) {
    const lk = k.toLowerCase();
    if (lk === "authorization" || lk.includes("cookie") || lk.includes("token") || lk.includes("key")) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
  const requestId = randomUUID();
  (res.locals as any).requestId = requestId;
  const startedAt = Date.now();

  let bodyPreview: unknown = undefined;
  try {
    if (req.body != null) {
      const asString = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      bodyPreview = truncate(asString, 1600);
    }
  } catch {
    bodyPreview = "[unserializable body]";
  }

  log.info("HTTP request", {
    requestId,
    method: req.method,
    path: req.originalUrl,
    headers: safeHeaders(req.headers as any),
    body: bodyPreview,
  });

  res.on("finish", () => {
    log.info("HTTP response", {
      requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      ms: Date.now() - startedAt,
    });
  });

  next();
}


