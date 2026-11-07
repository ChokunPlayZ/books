export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build" &&
    process.env.DATABASE_URL
  ) {
    const { getApp } = await import("./lib/server/app.ts");
    await getApp();
  }
}
