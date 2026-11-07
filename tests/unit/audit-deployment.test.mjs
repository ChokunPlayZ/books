import test from "node:test";
import assert from "node:assert/strict";
import nextConfig from "../../next.config.ts";

test("the unused unauthenticated image optimizer is disabled", () => {
  // The framework otherwise processes public paths even without next/image
  // imports. Unique /icons/<nonce>/../icon-512.png aliases cause fresh cache
  // entries, so restricting only query strings does not close this endpoint.
  assert.equal(nextConfig.images?.unoptimized, true);
});
