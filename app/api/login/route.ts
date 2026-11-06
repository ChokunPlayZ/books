import { json } from "../../../lib/server/http.ts";

// Explicitly retire the old password endpoint, including for existing clients.
export function POST() {
  return json(
    {
      message:
        "Password sign-in has been replaced by Google. Open /login to continue.",
    },
    410,
  );
}
