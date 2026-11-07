import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import { Readable, pipeline } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [
  ["2001::", 23], // Transition, benchmarking and other special-use ranges.
  ["2001:db8::", 32],
  ["2002::", 16], // 6to4 can encapsulate a private IPv4 destination.
  ["3fff::", 20],
] as const)
  blocked.addSubnet(address, prefix, "ipv6");

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  // Fail closed for mapped IPv4, NAT64, link-local, ULA, multicast and scopes.
  return (
    family === 6 &&
    !address.includes("%") &&
    globalV6.check(address, "ipv6") &&
    !blocked.check(address, "ipv6")
  );
}

// Resolve inside the socket's lookup callback, then connect to exactly the
// checked address. A separate preflight lookup followed by fetch is vulnerable
// to DNS rebinding. Reject mixed public/private DNS answers as well.
export async function publicAddresses(hostname: string, resolve = lookup) {
  const addresses = await resolve(hostname, { all: true, verbatim: true });
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicAddress(address))
  )
    throw new Error("Outbound destination is not a public address.");
  return addresses;
}

// Deliberately small fetch-compatible HTTPS transport for server integrations.
// Callers retain their host allowlist, redirect policy and decoded-body limits.
// No proxy environment variables, connection reuse or automatic redirects.
export const publicFetch: typeof fetch = async (
  input,
  options: RequestInit = {},
) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    isIP(url.hostname.replace(/^\[|\]$/g, ""))
  )
    throw new Error("Unsupported outbound destination.");
  if (options.redirect !== "manual" && options.redirect !== "error")
    throw new Error("Outbound requests require an explicit redirect policy.");
  const headers = new Headers(options.headers);
  headers.set("accept-encoding", "gzip, deflate, br");
  const body = options.body;
  if (
    body != null &&
    typeof body !== "string" &&
    !(body instanceof URLSearchParams)
  )
    throw new Error("Unsupported outbound request body.");
  return await new Promise<Response>((resolve, reject) => {
    const req = request(
      url,
      {
        method: options.method || "GET",
        headers: Object.fromEntries(headers),
        signal: options.signal || undefined,
        agent: false,
        lookup(hostname, opts, callback) {
          publicAddresses(hostname).then(
            (addresses) => {
              if (opts.all) callback(null, addresses);
              else callback(null, addresses[0].address, addresses[0].family);
            },
            (error) => callback(error, [], 4),
          );
        },
      },
      (incoming) => {
        try {
          const status = incoming.statusCode || 502;
          if (status >= 300 && status < 400 && options.redirect === "error") {
            incoming.destroy();
            reject(new Error("Outbound redirect is not allowed."));
            return;
          }
          const encoding = String(
            incoming.headers["content-encoding"] || "",
          ).toLowerCase();
          const decoder =
            encoding === "gzip"
              ? createGunzip()
              : encoding === "deflate"
                ? createInflate()
                : encoding === "br"
                  ? createBrotliDecompress()
                  : null;
          if (encoding && encoding !== "identity" && !decoder) {
            incoming.destroy();
            reject(new Error("Unsupported outbound content encoding."));
            return;
          }
          const responseHeaders = new Headers();
          for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
            const name = incoming.rawHeaders[i];
            if (decoder && /^(?:content-encoding|content-length)$/i.test(name))
              continue;
            responseHeaders.append(name, incoming.rawHeaders[i + 1]);
          }
          if ([204, 205, 304].includes(status)) {
            incoming.destroy();
            resolve(new Response(null, { status, headers: responseHeaders }));
            return;
          }
          if (decoder) pipeline(incoming, decoder, () => {});
          resolve(
            new Response(
              Readable.toWeb(decoder || incoming, {
                strategy: {
                  highWaterMark: 64 * 1024,
                  size: (chunk) => chunk.byteLength,
                },
              }) as ReadableStream<Uint8Array>,
              {
                status,
                headers: responseHeaders,
              },
            ),
          );
        } catch (error) {
          incoming.destroy();
          reject(error);
        }
      },
    );
    req.on("error", reject);
    req.on("upgrade", (_response, socket) => {
      socket.destroy();
      reject(new Error("Outbound protocol upgrades are not allowed."));
    });
    req.end(body == null ? undefined : String(body));
  });
};

// Injected transports are trusted application/test dependencies, not user input.
export function outboundFetch(fetchImpl: typeof fetch) {
  return fetchImpl === globalThis.fetch ? publicFetch : fetchImpl;
}
