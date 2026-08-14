export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { loadWebConfig } = await import("./src/config");
    loadWebConfig();
  }
}
