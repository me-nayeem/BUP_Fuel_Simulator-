export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startControlLoop } = await import('./lib/engine/loop');
    startControlLoop();
  }
}
