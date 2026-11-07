import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getApp } from "./app.ts";
import { sessionUser, SESSION_COOKIE } from "./auth.ts";

export const adminSession = cache(async () => {
  const { store } = await getApp();
  return sessionUser(store, (await cookies()).get(SESSION_COOKIE)?.value);
});

export async function requireAdminPage() {
  const user = await adminSession();
  if (!user) redirect("/login?returnTo=%2Fadmin");
  if (user.role !== "admin") notFound();
  return user;
}
