import fs from "node:fs";
import path from "node:path";

export function ensureUploadsDir(): string {
  const dir = path.resolve(process.cwd(), "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function sanitizeFilename(name: string): string {
  return (name || "file")
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 140);
}


