import { GET as storedCover } from "../route.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request, context) {
  const { id } = await context.params;
  const url = new URL(request.url);
  url.search = "";
  url.searchParams.set("id", id);
  return storedCover(new Request(url, { headers: request.headers }));
}
