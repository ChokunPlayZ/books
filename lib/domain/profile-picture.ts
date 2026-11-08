/** Only render HTTPS profile images from Google's image host. */
export function googleProfilePicture(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !(
        url.hostname === "googleusercontent.com" ||
        url.hostname.endsWith(".googleusercontent.com")
      )
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
