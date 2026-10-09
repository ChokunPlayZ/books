import Script from "next/script";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import CollectionShell from "../components/CollectionShell.jsx";
import { getApp } from "../lib/server/app.mjs";
import { hasSession, SESSION_COOKIE } from "../lib/server/auth.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export default async function CollectionPage() {
  if (!hasSession(getApp().store, (await cookies()).get(SESSION_COOKIE)?.value))
    redirect("/login");
  return (
    <>
      <CollectionShell />
      <Script
        src="https://cdn.jsdelivr.net/npm/zxing-wasm@3.1.5/dist/iife/reader/index.js"
        strategy="afterInteractive"
      />
      <Script src="/collection.js" strategy="afterInteractive" />
    </>
  );
}
