export async function register() {
  // Only the Node.js server process checks for updates; never the browser or the edge runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startUpdateChecker } = await import("@/lib/update-check/checker");
  startUpdateChecker();
}
