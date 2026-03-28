import net from 'node:net';

const host = process.env.PGHOST ?? '127.0.0.1';
const port = Number(process.env.PGPORT ?? '5432');
const maxAttempts = 60;
const delayMs = 1000;

function tryConnect() {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port }, () => {
      socket.end();
      resolve();
    });
    socket.setTimeout(2000);
    socket.on('error', () => reject(new Error('connect failed')));
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('timeout'));
    });
  });
}

async function main() {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await tryConnect();
      console.warn(`[finance-zap] Postgres reachable at ${host}:${String(port)}`);
      return;
    } catch {
      process.stdout.write('.');
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  console.error(
    `\n[finance-zap] Postgres not reachable at ${host}:${String(port)} after ${String(maxAttempts)}s`,
  );
  process.exit(1);
}

await main();
