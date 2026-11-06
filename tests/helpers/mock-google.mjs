// Test-only Google transport. Loaded explicitly with node --import by isolated
// test servers; production code has no mock-provider or insecure-OIDC switch.
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
} from "node:crypto";

export const mockClientId = "books-test-google-client";
export const mockClientSecret = "books-test-google-secret";

export function googleTestEnvironment() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    BOOKS_TEST_GOOGLE_PRIVATE_KEY: privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString(),
    BOOKS_GOOGLE_CLIENT_ID: mockClientId,
    BOOKS_GOOGLE_CLIENT_SECRET: mockClientSecret,
    BOOKS_ADMIN_EMAIL: "owner@gmail.com",
  };
}

export function googleTransport(pem, fallback = globalThis.fetch) {
  const privateKey = createPrivateKey(pem);
  const jwk = {
    ...createPublicKey(privateKey).export({ format: "jwk" }),
    kid: "test-google",
    alg: "RS256",
    use: "sig",
  };
  return async (input, options = {}) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === "https://www.googleapis.com/oauth2/v3/certs")
      return Response.json({ keys: [jwk] });
    if (url !== "https://oauth2.googleapis.com/token")
      return fallback(input, options);
    const body = new URLSearchParams(await new Request(input, options).text());
    const code = JSON.parse(
      Buffer.from(body.get("code"), "base64url").toString(),
    );
    const challenge = createHash("sha256")
      .update(body.get("code_verifier") || "")
      .digest("base64url");
    if (
      body.get("client_id") !== mockClientId ||
      body.get("client_secret") !== mockClientSecret ||
      challenge !== code.challenge
    )
      return Response.json({ error: "invalid_grant" }, { status: 400 });
    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: "https://accounts.google.com",
      aud: mockClientId,
      iat: now,
      exp: now + 300,
      email_verified: true,
      ...code.claims,
    };
    const unsigned =
      Buffer.from(
        JSON.stringify({ alg: "RS256", kid: "test-google" }),
      ).toString("base64url") +
      "." +
      Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = sign(
      "RSA-SHA256",
      Buffer.from(unsigned),
      privateKey,
    ).toString("base64url");
    return Response.json({
      token_type: "Bearer",
      access_token: "test-access-token-never-persist",
      expires_in: 300,
      id_token: unsigned + "." + signature,
    });
  };
}

export function authorizationCallback(
  authorizationUrl,
  identity,
  overrides = {},
) {
  const url = new URL(authorizationUrl);
  const callback = new URL(url.searchParams.get("redirect_uri"));
  callback.searchParams.set("state", url.searchParams.get("state"));
  callback.searchParams.set(
    "code",
    Buffer.from(
      JSON.stringify({
        challenge: url.searchParams.get("code_challenge"),
        claims: {
          ...identity,
          nonce: url.searchParams.get("nonce"),
          ...overrides,
        },
      }),
    ).toString("base64url"),
  );
  return callback;
}

export async function mockGooglePage(page, identity) {
  // Playwright only routes the first request in a server-redirect chain. Keep
  // the real start response/cookie, then navigate explicitly to the fake Google
  // document so no test ever contacts Google's actual sign-in service.
  await page.route("**/api/auth/google?**", async (route) => {
    const response = await route.fetch({ maxRedirects: 0 });
    const location = response.headers().location;
    if (
      response.status() !== 303 ||
      !location?.startsWith("https://accounts.google.com/")
    )
      throw new Error(
        "Google start did not return its expected redirect: " +
          (await response.text()),
      );
    await route.fulfill({
      response,
      status: 200,
      headers: {
        ...response.headers(),
        location: "",
        "content-type": "text/html",
      },
      body: `<script>location.replace(${JSON.stringify(location)})</script>`,
    });
  });
  await page.route(
    "https://accounts.google.com/o/oauth2/v2/auth?**",
    async (route) => {
      const callback = authorizationCallback(route.request().url(), identity);
      // A real cross-site document navigation exercises SameSite=Lax cookies.
      await route.fulfill({
        contentType: "text/html",
        body: `<script>location.replace(${JSON.stringify(callback.href)})</script>`,
      });
    },
  );
}

if (process.env.BOOKS_TEST_GOOGLE_PRIVATE_KEY)
  globalThis.fetch = googleTransport(process.env.BOOKS_TEST_GOOGLE_PRIVATE_KEY);
