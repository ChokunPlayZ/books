import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import CollectionShell from "../components/CollectionShell";
import CollectionController from "../components/CollectionController";
import { getApp } from "../lib/server/app.ts";
import { hasSession, SESSION_COOKIE } from "../lib/server/auth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function CollectionPage() {
  if (!hasSession(getApp().store, (await cookies()).get(SESSION_COOKIE)?.value))
    redirect("/login");
  return (
    <>
      <CollectionShell />
      <CollectionController />
    </>
  );
}
