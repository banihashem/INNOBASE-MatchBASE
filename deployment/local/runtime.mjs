import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { loadLocalConfig } from "./config.mjs";

const kind = process.argv[2];
if (!["web", "worker", "dashboard"].includes(kind))
  throw new Error("Unknown local runtime component.");
if (kind !== "dashboard") await loadLocalConfig();
if (kind === "worker") {
  const { createPool } = await import("../../packages/data/dist/index.js");
  const healthPool = createPool({
    connectionString: process.env.MATCHBASE_DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 2000,
    statement_timeout: 2000,
  });
  const server = createServer(async (_request, response) => {
    try {
      await healthPool.query(
        "SELECT job_id FROM consultant_workflow_job LIMIT 0",
      );
      response.writeHead(200).end("ready");
    } catch {
      response.writeHead(503).end("queue unavailable");
    }
  });
  server.listen(3011, "0.0.0.0");
  const close = () => {
    server.close();
    void healthPool.end();
  };
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
  await import("../../packages/application/dist/consultant-worker-cli.js");
  if (server.listening) close();
} else {
  const cwd =
    kind === "web" ? "/workspace/apps/web" : "/workspace/apps/dashboard";
  const args =
    kind === "web"
      ? [
          "node_modules/next/dist/bin/next",
          "dev",
          "--hostname",
          "0.0.0.0",
          "--port",
          "3000",
        ]
      : [
          "node_modules/vite/bin/vite.js",
          "preview",
          "--host",
          "0.0.0.0",
          "--port",
          "5173",
          "--strictPort",
        ];
  const child = spawn(process.execPath, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => child.kill(signal));
  child.on("error", () => {
    console.error("Local component could not start.");
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 0;
  });
}
