import { NextResponse } from "next/server";
import { AppError } from "./store.ts";

export function json<T>(value: T, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export function errorResponse(error) {
  if (!error.status && !(error instanceof SyntaxError))
    console.error("Book Collection request failed:", error.message);
  const status = error.status || (error instanceof SyntaxError ? 400 : 400);
  return json(
    {
      message:
        error instanceof SyntaxError
          ? "The request could not be read."
          : error.message || "The request failed.",
    },
    status,
  );
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new AppError("Open this action from your library.", 403);
  if (origin && new URL(origin).host !== request.headers.get("host"))
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
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError("Expected a JSON request.", 415);
  return JSON.parse((await readBody(request, limit)).toString("utf8"));
}
