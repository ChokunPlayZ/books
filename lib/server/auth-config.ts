import { AppError } from "./store.ts";

// Never derive security boundaries or OAuth redirect URIs from forwarded headers.
export function appOrigin() {
  const raw = process.env.BOOKS_APP_URL;
  if (!raw)
    throw new AppError("Google sign-in is not configured on this server.", 503);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError("BOOKS_APP_URL must be an HTTPS origin.", 503);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new AppError(
      "BOOKS_APP_URL must be an HTTPS origin (HTTP is allowed only on localhost).",
      503,
    );
  return url.origin;
}

export function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ? email
    : "";
}

export function googleSettings() {
  const origin = appOrigin();
  const clientId = process.env.BOOKS_GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.BOOKS_GOOGLE_CLIENT_SECRET?.trim();
  const adminEmail = normalizeEmail(process.env.BOOKS_ADMIN_EMAIL);
  if (!clientId || !clientSecret || !adminEmail)
    throw new AppError("Google sign-in is not configured on this server.", 503);
  return {
    origin,
    clientId,
    clientSecret,
    adminEmail,
    redirectUri: origin + "/api/auth/google/callback",
  };
}

export function safeReturnTo(value: unknown) {
  if (
    typeof value !== "string" ||
    value.length > 2000 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\x00-\x20\x7f]/.test(value)
  )
    return "/";
  const url = new URL(value, "https://library.invalid");
  if (
    url.origin !== "https://library.invalid" ||
    url.pathname.startsWith("/api/") ||
    url.pathname === "/login"
  )
    return "/";
  return url.pathname + url.search + url.hash;
}
