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
      "Book Collection request failed:",
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
  request: Request,
  limit = 20000,
): Promise<Buffer> {
  if (Number(request.headers.get("content-length")) > limit)
    throw new AppError("Request too large.", 413);
  const chunks: Buffer[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new AppError("Request too large.", 413);
      }
      chunks.push(Buffer.from(value));
    }
  }
  return Buffer.concat(chunks);
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
