"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
// Ensure repo-root .env is loaded even when server is started from ./server
// Load order:
// 1) repoRoot/.env
// 2) repoRoot/server/.env (optional override)
const repoRoot = node_path_1.default.resolve(__dirname, "..", "..");
const rootEnv = node_path_1.default.join(repoRoot, ".env");
const serverEnv = node_path_1.default.join(repoRoot, "server", ".env");
if (node_fs_1.default.existsSync(rootEnv)) {
    dotenv_1.default.config({ path: rootEnv });
}
if (node_fs_1.default.existsSync(serverEnv)) {
    dotenv_1.default.config({ path: serverEnv, override: true });
}
