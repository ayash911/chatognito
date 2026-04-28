import net from 'net';

const checkPort = (port: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(200);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, '127.0.0.1');
  });
};

export default async function globalSetup() {
  const isLive = await checkPort(8080);
  if (isLive) {
    console.log(
      '\nLive server detected on port 8080. Running integration tests against live instance...',
    );
    process.env.API_URL = 'http://localhost:8080';
  } else {
    console.log('\nNo live server detected');
  }
}
