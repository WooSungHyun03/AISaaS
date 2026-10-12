/** Worker settings, read once from the environment. Nothing here has a default that opens the worker up. */
export function loadConfig(env = process.env) {
  const token = env.WORKER_TOKEN ?? "";
  if (token.length < 16) throw new Error("WORKER_TOKEN must be set to a random string of at least 16 characters.");
  const hosts = (env.WORKER_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (hosts.length === 0) throw new Error("WORKER_ALLOWED_HOSTS must list the hosts the worker may download from and upload to (for example your-project.supabase.co).");
  return {
    token,
    port: Number(env.PORT ?? 8080),
    // "host.example.com" matches exactly; ".example.com" matches every subdomain.
    allowedHosts: hosts,
    // Tests only: lets the worker talk to 127.0.0.1 and plain http.
    allowLocal: env.WORKER_ALLOW_LOCAL === "1",
    maxDownloadBytes: Number(env.WORKER_MAX_DOWNLOAD_MB ?? 300) * 1024 * 1024,
    maxUploadBytes: Number(env.WORKER_MAX_UPLOAD_MB ?? 120) * 1024 * 1024,
    downloadTimeoutMs: Number(env.WORKER_DOWNLOAD_TIMEOUT_MS ?? 120_000),
    ffmpegTimeoutMs: Number(env.WORKER_FFMPEG_TIMEOUT_MS ?? 600_000),
    concurrency: Math.max(1, Number(env.WORKER_CONCURRENCY ?? 2)),
    jobTtlMs: Number(env.WORKER_JOB_TTL_MS ?? 60 * 60_000),
    tmpRoot: env.WORKER_TMP_DIR ?? "/tmp/autobiz-worker",
    fontFile: env.WORKER_FONT_FILE ?? "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
  };
}
