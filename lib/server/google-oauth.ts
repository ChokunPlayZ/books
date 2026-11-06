import { randomBytes } from "node:crypto";
import * as oidc from "openid-client";
import {
  authHash,
  cookieOptions,
  signInWithGoogle,
  type GoogleIdentity,
} from "./auth.ts";
import { googleSettings, safeReturnTo } from "./auth-config.ts";
import { AppError, type Store } from "./store.ts";

export const OAUTH_COOKIE = process.env.BOOKS_APP_URL?.trim()
  .toLowerCase()
  .startsWith("https:")
  ? "__Host-book_collection_oauth"
  : "book_collection_oauth";
const ATTEMPT_SECONDS = 600;

// Pin Google's endpoints instead of allowing configurable identity providers.
// Signature checking is enabled in addition to TLS and OIDC claim validation.
export function createGoogleClient(
  settings: ReturnType<typeof googleSettings>,
) {
  const client = new oidc.Configuration(
    {
      issuer: "https://accounts.google.com",
      authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      token_endpoint: "https://oauth2.googleapis.com/token",
      jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
      id_token_signing_alg_values_supported: ["RS256"],
      response_types_supported: ["code"],
    },
    settings.clientId,
    {
      client_secret: settings.clientSecret,
      id_token_signed_response_alg: "RS256",
    },
  );
  client.timeout = 15;
  oidc.enableNonRepudiationChecks(client);
  return client;
}

// Cached clients retain Google's rotating JWKS between requests.
let cached: { key: string; client: oidc.Configuration } | undefined;
function getClient(settings: ReturnType<typeof googleSettings>) {
  const key = authHash(settings.clientId + "\0" + settings.clientSecret);
  if (cached?.key !== key)
    cached = { key, client: createGoogleClient(settings) };
  return cached.client;
}

export function oauthCookieOptions() {
  return { ...cookieOptions(), maxAge: ATTEMPT_SECONDS };
}

export async function beginGoogleSignIn(store: Store, returnTo: unknown) {
  const settings = googleSettings();
  const now = Date.now();
  store.db.prepare("DELETE FROM oauth_attempts WHERE expires_at<=?").run(now);
  // A hard bound keeps unauthenticated requests from growing SQLite forever.
  const state = oidc.randomState();
  const browserToken = randomBytes(32).toString("hex");
  const verifier = oidc.randomPKCECodeVerifier();
  const nonce = oidc.randomNonce();
  const challenge = await oidc.calculatePKCECodeChallenge(verifier);
  if (
    Number(
      store.db.prepare("SELECT COUNT(*) AS n FROM oauth_attempts").get().n,
    ) >= 1000
  )
    throw new AppError("Sign-in is busy. Try again shortly.", 429);
  store.db
    .prepare(
      "INSERT INTO oauth_attempts (state_hash,browser_hash,code_verifier,nonce,return_to,expires_at) VALUES (?,?,?,?,?,?)",
    )
    .run(
      authHash(state),
      authHash(browserToken),
      verifier,
      nonce,
      safeReturnTo(returnTo),
      now + ATTEMPT_SECONDS * 1000,
    );
  const url = oidc.buildAuthorizationUrl(getClient(settings), {
    redirect_uri: settings.redirectUri,
    scope: "openid email",
    response_type: "code",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return { url, browserToken };
}

export function consumeGoogleAttempt(
  store: Store,
  state: string | null,
  browserToken?: string,
) {
  if (
    !state ||
    !/^[a-zA-Z0-9_-]{43}$/.test(state) ||
    !browserToken ||
    !/^[a-f0-9]{64}$/.test(browserToken)
  )
    throw new AppError("Sign-in expired. Please try again.", 400);
  // Atomic deletion prevents replay, including concurrent callbacks.
  const attempt = store.db
    .prepare(
      "DELETE FROM oauth_attempts WHERE state_hash=? AND browser_hash=? RETURNING *",
    )
    .get(authHash(state), authHash(browserToken));
  if (!attempt || Number(attempt.expires_at) <= Date.now())
    throw new AppError("Sign-in expired. Please try again.", 400);
  return {
    verifier: String(attempt.code_verifier),
    nonce: String(attempt.nonce),
    returnTo: String(attempt.return_to),
  };
}

export async function finishGoogleSignIn(
  store: Store,
  callback: URL,
  browserToken?: string,
  client?: oidc.Configuration,
) {
  const settings = googleSettings();
  // Use only the configured origin for the token exchange redirect URI.
  const url = new URL(settings.redirectUri);
  url.search = callback.search;
  const state = url.searchParams.get("state");
  const attempt = consumeGoogleAttempt(store, state, browserToken);
  const tokens = await oidc.authorizationCodeGrant(
    client ?? getClient(settings),
    url,
    {
      expectedState: state!,
      expectedNonce: attempt.nonce,
      pkceCodeVerifier: attempt.verifier,
      idTokenExpected: true,
    },
  );
  const claims = tokens.claims();
  if (!claims)
    throw new AppError(
      "Google did not return an identity. Please try again.",
      403,
    );
  const identity: GoogleIdentity = {
    sub: claims.sub,
    email: typeof claims.email === "string" ? claims.email : "",
    email_verified: claims.email_verified === true,
    hd: typeof claims.hd === "string" ? claims.hd : undefined,
  };
  // Access, refresh and ID tokens are neither persisted nor sent to the browser.
  return {
    ...signInWithGoogle(store, identity, settings.adminEmail),
    returnTo: attempt.returnTo,
  };
}
