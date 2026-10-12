import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { JobTable, validateJob, ValidationError } from "./jobs.mjs";
import { probeFile, run } from "./ffmpeg.mjs";
import { downloadToFile, tokenMatches } from "./security.mjs";

const MAX_BODY = 64 * 1024;

function send(response, status, body) {
  const text = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text), "cache-control": "no-store" });
  response.end(text);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new ValidationError("request body is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new ValidationError("invalid json"));
      }
    });
    request.on("error", reject);
  });
}

/**
 * The worker's HTTP surface:
 *   GET  /healthz            liveness (no auth)
 *   POST /v1/probe           {url} -> media facts (duration, size, fps, codecs); the app uses it to price and validate uploads
 *   POST /v1/jobs            {type: "analyze" | "compose", ...} -> 202 {jobId}
 *   GET  /v1/jobs/:id        -> {state: queued|running|done|failed, result?, error?}
 * Everything except /healthz needs `Authorization: Bearer <WORKER_TOKEN>`.
 */
export function createServer(config) {
  const jobs = new JobTable(config);
  const sweeper = setInterval(() => jobs.expire(), 60_000);
  sweeper.unref();

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://worker");
      if (request.method === "GET" && url.pathname === "/healthz") {
        return send(response, 200, { ok: true });
      }
      if (!tokenMatches(request.headers.authorization, config.token)) return send(response, 401, { error: "unauthorized" });

      if (request.method === "POST" && url.pathname === "/v1/probe") {
        const body = await readJson(request);
        if (typeof body.url !== "string") throw new ValidationError("url is required");
        const dir = path.join(config.tmpRoot, `probe-${randomUUID()}`);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        try {
          const file = path.join(dir, "input.bin");
          await downloadToFile(body.url, file, config);
          return send(response, 200, await probeFile(file));
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
      if (request.method === "POST" && url.pathname === "/v1/jobs") {
        const spec = validateJob(await readJson(request));
        return send(response, 202, { jobId: jobs.submit(spec) });
      }
      const match = url.pathname.match(/^\/v1\/jobs\/([0-9a-f-]{36})$/);
      if (request.method === "GET" && match) {
        const job = jobs.get(match[1]);
        return job ? send(response, 200, job) : send(response, 404, { error: "unknown job" });
      }
      return send(response, 404, { error: "not found" });
    } catch (error) {
      if (error instanceof ValidationError) return send(response, 400, { error: error.message });
      // Safe messages only: the app shows them to operators, never to customers.
      return send(response, 502, { error: String(error?.message ?? "worker error").slice(0, 200) });
    }
  });
  server.on("close", () => clearInterval(sweeper));
  return { server, jobs };
}

export async function ffmpegVersion() {
  const { stdout } = await run("ffmpeg", ["-version"], { timeoutMs: 10_000 });
  return stdout.split("\n")[0];
}
