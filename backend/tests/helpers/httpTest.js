import http from "node:http";
import express from "express";
import { validate } from "../../middleware/validate.js";
import { errorHandler } from "../../middleware/errorHandler.js";

/**
 * Minimal HTTP helper for route tests (no supertest dependency).
 */
export function startServer(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        port,
        close: () =>
          new Promise((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}

export function requestJson(port, { method = "GET", path, headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body != null ? JSON.stringify(body) : null;
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          Accept: "application/json",
          ...(payload
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(payload),
              }
            : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = { raw: text };
          }
          resolve({ status: res.statusCode, body: json, headers: res.headers });
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

export function createValidationApp({ method, path, schema, source = "body" }) {
  const app = express();
  app.use(express.json());
  app[method](path, validate(schema, source), (req, res) => {
    res.json({ success: true, data: req[source] });
  });
  app.use(errorHandler);
  return app;
}
