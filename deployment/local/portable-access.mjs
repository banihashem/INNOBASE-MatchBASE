// MB-UX-OPS-002 L07. A credential-free transport supervisor, not a research worker.
import { execFile } from "node:child_process";
import { readFile, writeFile, rename } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { createLanGateway } from "./lan-gateway.mjs";
import { isPrivateIPv4 } from "./config.mjs";

const execute = promisify(execFile);
const safeNames =
  /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|PROGRAMFILES|PROGRAMFILES\(X86\)|TEMP|TMP|LOCALAPPDATA|USERPROFILE)$/i;
export function transportEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => safeNames.test(name)),
  );
}
export function selectPortableAddress(addresses) {
  const eligible = [...new Set(addresses.filter(isPrivateIPv4))];
  // Never guess between multiple addresses, a VPN, a Docker adapter or a wildcard.
  return eligible.length === 1 ? eligible[0] : null;
}
export function validatePortableConfig(config) {
  if (
    config.version !== 1 ||
    !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(config.interfaceGuid) ||
    !Number.isInteger(config.port) ||
    config.port < 1024 ||
    config.port > 65535
  )
    throw new Error("Invalid portable access configuration.");
  return config;
}

export async function reconcilePortableGateway(
  current,
  next,
  port,
  factory = createLanGateway,
) {
  if (next !== null && !isPrivateIPv4(next))
    throw new Error("Unqualified LAN address.");
  if (next === current.address && current.gateway)
    return { ...current, state: "lan-listening" };
  if (current.gateway) await current.gateway.close();
  if (!next)
    return { gateway: null, address: null, state: "adapter-unavailable" };
  const candidate = factory({ address: next, port });
  try {
    await candidate.listen();
    return { gateway: candidate, address: next, state: "lan-listening" };
  } catch {
    await candidate.close();
    return { gateway: null, address: null, state: "lan-port-unavailable" };
  }
}

export async function runPortableAccess(configPath, controls = {}) {
  const io = {
    readFile,
    writeFile,
    rename,
    execute,
    gatewayFactory: createLanGateway,
    pause: (signal) => delay(15000, undefined, { signal }),
    events: process,
    ...controls,
  };
  const config = validatePortableConfig(
    JSON.parse(await io.readFile(configPath, "utf8")),
  );
  const statusPath = `${configPath}.status.json`;
  let gateway = null;
  let address = null;
  let stopping = false;
  let lastStatus = "";
  const abort = new AbortController();
  // The loop owns every listener. Shutdown never closes a previously published
  // listener concurrently with a candidate still awaiting listen().
  const stop = () => {
    stopping = true;
    abort.abort();
  };
  io.events.once("SIGTERM", stop);
  io.events.once("SIGINT", stop);
  try {
    while (!stopping) {
      let next = null;
      let state = "adapter-unavailable";
      try {
        const { stdout } = await io.execute(
          "powershell.exe",
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-File",
            fileURLToPath(
              new URL("./Get-PortableNetwork.ps1", import.meta.url),
            ),
            "-InterfaceGuid",
            config.interfaceGuid,
          ],
          {
            env: transportEnvironment(process.env),
            windowsHide: true,
            // Windows CIM module initialization can exceed ten seconds after
            // logon. Keep discovery bounded and cancellable without false loss.
            timeout: 30000,
            maxBuffer: 65536,
            signal: abort.signal,
          },
        );
        next = selectPortableAddress(
          JSON.parse(stdout.replace(/^\uFEFF/, "")).addresses,
        );
      } catch {
        state = "adapter-inspection-failed";
      }
      if (stopping) break;
      const result = await reconcilePortableGateway(
        { gateway, address },
        next,
        config.port,
        io.gatewayFactory,
      );
      gateway = result.gateway;
      address = result.address;
      // Stop may arrive while listen() is pending. finally closes the resulting
      // candidate before this supervisor can return.
      if (stopping) break;
      if (state !== "adapter-inspection-failed") state = result.state;
      const signature = `${state}:${address ?? ""}`;
      if (signature !== lastStatus) {
        // State contains no URLs requested, request bodies, headers or credentials.
        const status = {
          state,
          localhost: `http://localhost:${config.port}`,
          lan: address ? `http://${address}:${config.port}` : null,
          updatedAt: new Date().toISOString(),
        };
        try {
          await io.writeFile(`${statusPath}.tmp`, JSON.stringify(status));
          await io.rename(`${statusPath}.tmp`, statusPath);
          lastStatus = signature;
        } catch {
          // Status is auxiliary. A locked or unavailable file must not stop adapter
          // discovery. Retry on the next poll, including an unchanged network.
          lastStatus = "";
        }
      }
      if (!stopping) {
        try {
          await io.pause(abort.signal);
        } catch (error) {
          if (!stopping || error?.name !== "AbortError") throw error;
        }
      }
    }
  } finally {
    io.events.removeListener("SIGTERM", stop);
    io.events.removeListener("SIGINT", stop);
    if (gateway) await gateway.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  // The task also clears its inherited environment before starting this process.
  for (const name of Object.keys(process.env))
    if (!safeNames.test(name)) delete process.env[name];
  runPortableAccess(process.argv[2]).catch(() => {
    process.stderr.write("Portable access stopped; inspect launcher status.\n");
    process.exitCode = 1;
  });
}
