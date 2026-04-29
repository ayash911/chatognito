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
  const [authLive, messagingLive, socialLive, gatewayLive, contentLive] = await Promise.all([
    checkPort(8080),
    checkPort(8081),
    checkPort(8082),
    checkPort(8083),
    checkPort(8084),
  ]);

  if (authLive || messagingLive || socialLive || gatewayLive || contentLive) {
    console.log('\nLive servers detected:');
    if (authLive) {
      console.log(' - Auth Service (8080)');
      process.env.AUTH_URL = 'http://localhost:8080';
      process.env.API_URL = 'http://localhost:8080'; // For backward compatibility
    }
    if (messagingLive) {
      console.log(' - Messaging Service (8081)');
      process.env.MESSAGING_URL = 'http://localhost:8081';
    }
    if (socialLive) {
      console.log(' - Social Service (8082)');
      process.env.SOCIAL_URL = 'http://localhost:8082';
    }
    if (gatewayLive) {
      console.log(' - Gateway Service (8083)');
      process.env.GATEWAY_URL = 'http://localhost:8083';
    }
    if (contentLive) {
      console.log(' - Content Service (8084)');
      process.env.CONTENT_URL = 'http://localhost:8084';
    }
    console.log('Integration tests will run against live instances.\n');
  } else {
    console.log('\nNo live servers detected. Using internal app instances.\n');
  }
}
