import fs from "node:fs";
import path from "node:path";

type LogLevel = "INFO" | "WARN" | "ERROR";

function getLogFilePath(): string {
  // Set LOG_FILE to override. Default: ./logs/server.log.txt relative to server process cwd.
  const envPath = (process.env.LOG_FILE || "").trim();
  if (envPath) return envPath;
  return path.resolve(process.cwd(), "logs", "server.log.txt");
}

function ensureLogDir(filePath: string) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch {
    // ignore
  }
}

function safeMeta(meta?: Record<string, unknown>) {
  if (!meta) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    // never log secrets if they get passed accidentally
    if (k.toLowerCase().includes("key") || k.toLowerCase().includes("secret") || k.toLowerCase().includes("token")) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

function appendToFile(lines: string[]) {
  const filePath = getLogFilePath();
  ensureLogDir(filePath);
  try {
    fs.appendFileSync(filePath, lines.join("\n") + "\n", "utf-8");
  } catch {
    // If file logging fails, keep console logging.
  }
}

function write(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const ts = new Date().toISOString();
  const line = `[${level}] ${ts} ${message}`;
  const m = safeMeta(meta);
  const metaLine = m && Object.keys(m).length ? JSON.stringify(m) : null;
  const botLine = `Bot: True`;

  // Console
  if (level === "ERROR") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.log(line);
  if (metaLine) console.log(metaLine);
  console.log(botLine);

  // File
  appendToFile([line, ...(metaLine ? [metaLine] : []), botLine]);
}

export const log = {
  info: (message: string, meta?: Record<string, unknown>) => write("INFO", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write("WARN", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write("ERROR", message, meta),
  // helpful for debugging
  filePath: () => getLogFilePath(),
};


