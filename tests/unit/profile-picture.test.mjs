import test from "node:test";
import assert from "node:assert/strict";
import { googleProfilePicture } from "../../lib/domain/profile-picture.ts";

test("only HTTPS Google image URLs are accepted as profile pictures", () => {
  const picture = "https://lh3.googleusercontent.com/a/profile=s96-c";
  assert.equal(googleProfilePicture(picture), picture);
  for (const value of [
    undefined,
    null,
    123,
    "",
    "/profile.png",
    "javascript:alert(1)",
    "data:image/svg+xml,<svg/>",
    "http://lh3.googleusercontent.com/a/profile",
    "https://googleusercontent.com.evil.test/profile",
    "https://evilgoogleusercontent.com/profile",
    "https://user:pass@lh3.googleusercontent.com/profile",
    "https://lh3.googleusercontent.com:444/profile",
    "https://lh3.googleusercontent.com/" + "a".repeat(2048),
  ])
    assert.equal(googleProfilePicture(value), null, String(value));
});
