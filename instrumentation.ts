// Runs once when the Next.js server starts. The Node-only work lives in its
// own module so the edge bundle never pulls in pg / fs.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node');
  }
}
