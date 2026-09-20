import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    // Importing src/server/automations/scheduler.ts pulls in the Supabase
    // admin client module for its (unused-by-these-tests) findDueAutomations
    // export, which validates env vars at import time — provide harmless
    // placeholders so pure-logic tests don't need a real Supabase project.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "placeholder-anon-key",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
      // Server-only code under test runs in a plain Node process here (never
      // a browser bundle), so treat the "server-only" guard as a no-op —
      // the real protection is the Next.js client/server build split.
      "server-only": path.resolve(dirname, "./node_modules/server-only/empty.js"),
    },
  },
});
