// Next.js Instrumentation — runs once when the server process starts.
// O código fica em instrumentation-node.ts: importado só sob esta condição, o
// Next o remove do bundle do Edge (senão web-push/https quebram o build).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node");
    await registerNode();
  }
}
