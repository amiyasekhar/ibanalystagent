"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.log = void 0;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
function getLogFilePath() {
    // Set LOG_FILE to override. Default: ./logs/server.log.txt relative to server process cwd.
    const envPath = (process.env.LOG_FILE || "").trim();
    if (envPath)
        return envPath;
    return node_path_1.default.resolve(process.cwd(), "logs", "server.log.txt");
}
function ensureLogDir(filePath) {
    try {
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(filePath), { recursive: true });
    }
    catch {
        // ignore
    }
}
function clearLogFile() {
    const filePath = getLogFilePath();
    ensureLogDir(filePath);
    try {
        node_fs_1.default.writeFileSync(filePath, "", "utf-8");
    }
    catch {
        // ignore
    }
}
function safeMeta(meta) {
    if (!meta)
        return undefined;
    const out = {};
    for (const [k, v] of Object.entries(meta)) {
        // never log secrets if they get passed accidentally
        if (k.toLowerCase().includes("key") || k.toLowerCase().includes("secret") || k.toLowerCase().includes("token")) {
            out[k] = "[REDACTED]";
        }
        else {
            out[k] = v;
        }
    }
    return out;
}
function appendToFile(lines) {
    const filePath = getLogFilePath();
    ensureLogDir(filePath);
    try {
        node_fs_1.default.appendFileSync(filePath, lines.join("\n") + "\n", "utf-8");
    }
    catch {
        // If file logging fails, keep console logging.
    }
}
function write(level, message, meta) {
    const ts = new Date().toISOString();
    const line = `[${level}] ${ts} ${message}`;
    const m = safeMeta(meta);
    const metaLine = m && Object.keys(m).length ? JSON.stringify(m) : null;
    const botLine = `Bot: True`;
    // Console
    if (level === "ERROR")
        console.error(line);
    else if (level === "WARN")
        console.warn(line);
    else
        console.log(line);
    if (metaLine)
        console.log(metaLine);
    console.log(botLine);
    // File
    appendToFile([line, ...(metaLine ? [metaLine] : []), botLine]);
}
exports.log = {
    info: (message, meta) => write("INFO", message, meta),
    warn: (message, meta) => write("WARN", message, meta),
    error: (message, meta) => write("ERROR", message, meta),
    // helpful for debugging
    filePath: () => getLogFilePath(),
    clear: () => clearLogFile(),
};
