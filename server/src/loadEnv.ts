import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";

// Ensure repo-root .env is loaded even when server is started from ./server
// Load order:
// 1) repoRoot/.env
// 2) repoRoot/server/.env (optional override)

const repoRoot = path.resolve(__dirname, "..", "..");
const rootEnv = path.join(repoRoot, ".env");
const serverEnv = path.join(repoRoot, "server", ".env");

if (fs.existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv });
}

if (fs.existsSync(serverEnv)) {
  dotenv.config({ path: serverEnv, override: true });
}


