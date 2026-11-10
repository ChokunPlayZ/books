import { NextResponse } from "next/server.js";
import { AppError } from "./store.ts";
import { appOrigin } from "./auth-config.ts";

export function json<T>(value: T, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export function errorResponse(error: unknown) {
  const expected = error instanceof AppError;
  if (!expected && !(error instanceof SyntaxError))
    console.error(
      "meemai request failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
  const status = expected
    ? error.status
    : error instanceof SyntaxError
      ? 400
      : 500;
  return json(
    {
      message:
        error instanceof SyntaxError
          ? "The request could not be read."
          : expected
            ? error.message
            : "The request failed. Please try again.",
      ...(expected && error.editConflict
        ? { editConflict: error.editConflict }
        : {}),
    },
    status,
  );
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  const expected = process.env.BOOKS_APP_URL
    ? appOrigin()
    : new URL(request.url).origin;
  // Compare the full origin, including scheme and port. Forwarded Host headers
  // are not a trust boundary. Headerless non-browser API clients remain usable.
  if (
    site === "cross-site" ||
    (origin ? origin !== expected : site === "same-site")
  )
    throw new AppError("Open this action from your library.", 403);
}
export async function readBody(
  request: Pick<Request, "headers" | "body">,
  limit = 20000,
  timeoutMs = 30_000,
): Promise<Buffer> {
  if (Number(request.headers.get("content-length")) > limit) {
    void request.body?.cancel().catch(() => {});
    throw new AppError("Request too large.", 413);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    let chunk: Buffer,
      used = 0;
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new AppError("Request body timed out.", 408));
        void reader.cancel().catch(() => {});
      }, timeoutMs);
    });
    try {
      await Promise.race([
        (async () => {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > limit) {
              void reader.cancel().catch(() => {});
              throw new AppError("Request too large.", 413);
            }
            // Coalesce tiny network chunks. A byte cap alone otherwise allows
            // millions of Buffer objects and stream-promise bookkeeping.
            for (let offset = 0; offset < value.byteLength;) {
              if (!chunk || used === chunk.length) {
                chunk = Buffer.allocUnsafe(Math.min(64 * 1024, limit));
                chunks.push(chunk);
                used = 0;
              }
              const count = Math.min(
                chunk.length - used,
                value.byteLength - offset,
              );
              chunk.set(value.subarray(offset, offset + count), used);
              offset += count;
              used += count;
            }
          }
        })(),
        timeout,
      ]);
      if (chunk) chunks[chunks.length - 1] = chunk.subarray(0, used);
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
    }
  }
  return Buffer.concat(chunks, size);
}
export async function readJson(request: Request, limit = 20000) {
  if (
    !/^application\/json(?:\s*;|$)/i.test(
      request.headers.get("content-type") || "",
    )
  )
    throw new AppError("Expected a JSON request.", 415);
  const value = JSON.parse((await readBody(request, limit)).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AppError("Expected a JSON object.");
  return value;
}
