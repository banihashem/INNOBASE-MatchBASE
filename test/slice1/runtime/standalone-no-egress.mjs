// Test-only preload: the standalone fixture may listen, but may not dial any service.
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import dgram from "node:dgram";
import { syncBuiltinESMExports } from "node:module";

function denied() {
  throw new Error(
    "MB-TEST-NO-EGRESS: standalone fixture outbound network access refused.",
  );
}
net.Socket.prototype.connect = denied;
tls.connect = denied;
dgram.Socket.prototype.connect = denied;
dgram.Socket.prototype.send = denied;
for (const name of Object.keys(dns)) {
  if (
    name === "lookup" ||
    name === "lookupService" ||
    name === "reverse" ||
    name.startsWith("resolve")
  )
    dns[name] = denied;
}
for (const name of Object.keys(dns.promises)) {
  if (
    name === "lookup" ||
    name === "lookupService" ||
    name === "reverse" ||
    name.startsWith("resolve")
  )
    dns.promises[name] = async () => denied();
}
for (const name of Object.getOwnPropertyNames(dns.Resolver.prototype)) {
  if (name === "reverse" || name.startsWith("resolve"))
    dns.Resolver.prototype[name] = denied;
}
for (const name of Object.getOwnPropertyNames(
  dns.promises.Resolver.prototype,
)) {
  if (name === "reverse" || name.startsWith("resolve"))
    dns.promises.Resolver.prototype[name] = async () => denied();
}
// Node's listener resolves its numeric bind address through lookup too; no DNS is needed.
dns.lookup = (hostname, options, callback) => {
  if (!["127.0.0.1", "::1"].includes(hostname)) return denied();
  const complete = typeof options === "function" ? options : callback;
  const family = net.isIP(hostname);
  queueMicrotask(() =>
    options?.all
      ? complete(null, [{ address: hostname, family }])
      : complete(null, hostname, family),
  );
};
globalThis.fetch = async () => denied();
syncBuiltinESMExports();
