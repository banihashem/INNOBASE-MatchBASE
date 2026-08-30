import { describe, expect, it } from "vitest";
import { readBoundedRequestBody } from "./bounded-request-body";

describe("bounded request body", () => {
  it("streams and returns a body within the byte limit", async () => {
    const request = new Request("https://matchbase.example/auth/google/risc", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("signed."));
          controller.enqueue(new TextEncoder().encode("jwt"));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    await expect(readBoundedRequestBody(request, 10)).resolves.toBe(
      "signed.jwt",
    );
  });

  it("cancels a chunked body before buffering bytes above the limit", async () => {
    let cancelled = false;
    const request = new Request("https://matchbase.example/auth/google/risc", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(20));
        },
        cancel() {
          cancelled = true;
        },
      }),
      duplex: "half",
    } as RequestInit);
    await expect(readBoundedRequestBody(request, 8)).rejects.toThrow(
      /byte limit/u,
    );
    expect(cancelled).toBe(true);
  });

  it("rejects an oversized declared length without reading the stream", async () => {
    const request = new Request("https://matchbase.example/auth/google/risc", {
      method: "POST",
      headers: { "Content-Length": "9" },
      body: "123456789",
    });
    await expect(readBoundedRequestBody(request, 8)).rejects.toThrow(
      /byte limit/u,
    );
  });

  it("rejects a lying small Content-Length after the streamed bytes cross the limit", async () => {
    const request = new Request("https://matchbase.example/auth/google/risc", {
      method: "POST",
      headers: { "Content-Length": "1" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(9));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    await expect(readBoundedRequestBody(request, 8)).rejects.toThrow(
      /byte limit/u,
    );
  });

  it("counts UTF-8 bytes rather than JavaScript characters", async () => {
    const request = new Request("https://matchbase.example/auth/google/risc", {
      method: "POST",
      body: "🔒🔒",
    });
    await expect(readBoundedRequestBody(request, 7)).rejects.toThrow(
      /byte limit/u,
    );
  });

  it("keeps concurrent request limits independent", async () => {
    const make = (value: string) =>
      new Request("https://matchbase.example/auth/google/risc", {
        method: "POST",
        body: value,
      });
    await expect(
      Promise.all([
        readBoundedRequestBody(make("12345678"), 8),
        readBoundedRequestBody(make("abcdefgh"), 8),
      ]),
    ).resolves.toEqual(["12345678", "abcdefgh"]);
  });
});
