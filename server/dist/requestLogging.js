"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestLoggingMiddleware = requestLoggingMiddleware;
const node_crypto_1 = require("node:crypto");
const logger_1 = require("./logger");
function truncate(s, max = 1200) {
    if (s.length <= max)
        return s;
    return s.slice(0, max) + `…(+${s.length - max} chars)`;
}
function safeHeaders(headers) {
    const out = {};
    for (const [k, v] of Object.entries(headers)) {
        const lk = k.toLowerCase();
        if (lk === "authorization" || lk.includes("cookie") || lk.includes("token") || lk.includes("key")) {
            out[k] = "[REDACTED]";
        }
        else {
            out[k] = v;
        }
    }
    return out;
}
function requestLoggingMiddleware(req, res, next) {
    const requestId = (0, node_crypto_1.randomUUID)();
    res.locals.requestId = requestId;
    const startedAt = Date.now();
    let bodyPreview = undefined;
    try {
        if (req.body != null) {
            const asString = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
            bodyPreview = truncate(asString, 1600);
        }
    }
    catch {
        bodyPreview = "[unserializable body]";
    }
    logger_1.log.info("HTTP request", {
        requestId,
        method: req.method,
        path: req.originalUrl,
        headers: safeHeaders(req.headers),
        body: bodyPreview,
    });
    res.on("finish", () => {
        logger_1.log.info("HTTP response", {
            requestId,
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            ms: Date.now() - startedAt,
        });
    });
    next();
}
