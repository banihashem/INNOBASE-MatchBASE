import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { gzipSync } from "node:zlib";

import { readBoundedProviderJson } from "../../packages/application/dist/live-research-environment-runtime.js";

async function withServer(handler, run) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test("provider JSON reader cuts off chunked and compressed bodies before unbounded materialization", async () => {
  const oversizedJson = JSON.stringify({
    payload: "x".repeat(2 * 1024 * 1024),
  });
  const compressed = gzipSync(oversizedJson);
  await withServer(
    (request, response) => {
      if (request.url === "/chunked") {
        response.writeHead(200, { "content-type": "application/json" });
        for (let offset = 0; offset < oversizedJson.length; offset += 16_384)
          response.write(oversizedJson.slice(offset, offset + 16_384));
        response.end();
        return;
      }
      response.writeHead(200, {
        "content-type": "application/json",
        "content-encoding": "gzip",
        "content-length": String(compressed.byteLength),
      });
      response.end(compressed);
    },
    async (origin) => {
      await assert.rejects(
        readBoundedProviderJson(await fetch(`${origin}/chunked`)),
        /bounded JSON limit/u,
      );
      await assert.rejects(
        readBoundedProviderJson(await fetch(`${origin}/compressed`)),
        /bounded JSON limit/u,
      );
    },
  );
});

test("provider JSON reader accepts a bounded streamed object", async () => {
  const body = JSON.stringify({ result: "bounded" });
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body.slice(0, 8)));
      controller.enqueue(new TextEncoder().encode(body.slice(8)));
      controller.close();
    },
  });
  assert.deepEqual(
    await readBoundedProviderJson(
      new Response(stream, { headers: { "content-type": "application/json" } }),
    ),
    { result: "bounded" },
  );
});
