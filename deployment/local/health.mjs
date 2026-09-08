const endpoints = {
  web: "http://127.0.0.1:3000/api/v1/readiness",
  worker: "http://127.0.0.1:3011/",
  dashboard: "http://127.0.0.1:5173/",
};
try {
  const endpoint = endpoints[process.argv[2]];
  if (!endpoint) throw new Error("Unknown component.");
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(4000) });
  if (!response.ok) process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
