import { logger } from '@chatognito/logger';

export interface ServiceStatus {
  name: string;
  url: string;
  status: 'up' | 'down';
  latency?: number;
  lastChecked: string;
}

export class HealthService {
  private static services = [
    { name: 'Auth Service', url: 'http://localhost:8080/identity/health' },
    { name: 'Messaging Service', url: 'http://localhost:8081/messaging/health' },
    { name: 'Social Service', url: 'http://localhost:8082/social/health' },
    { name: 'Gateway Service', url: 'http://localhost:8083/gateway/health' },
    { name: 'Content Service', url: 'http://localhost:8084/content/health' },
  ];

  private static statusCache: Record<string, ServiceStatus> = {};

  /**
   * Pings all services and updates the cache.
   */
  static async checkAll() {
    const results = await Promise.all(
      this.services.map(async (svc) => {
        const start = Date.now();
        try {
          // Use fetch (available in Node 18+)
          const res = await fetch(svc.url, { signal: AbortSignal.timeout(2000) });
          const latency = Date.now() - start;
          const status: ServiceStatus = {
            name: svc.name,
            url: svc.url,
            status: res.ok ? 'up' : 'down',
            latency,
            lastChecked: new Date().toISOString(),
          };
          this.statusCache[svc.name] = status;
          return status;
        } catch (_err) {
          const status: ServiceStatus = {
            name: svc.name,
            url: svc.url,
            status: 'down',
            lastChecked: new Date().toISOString(),
          };
          this.statusCache[svc.name] = status;
          return status;
        }
      }),
    );
    return results;
  }

  /**
   * Returns the last known status of all services.
   */
  static getCachedStatus() {
    return Object.values(this.statusCache);
  }

  /**
   * Starts a background interval to check health.
   */
  static startBackgroundCheck(intervalMs = 30000) {
    logger.info(`Starting background health checks every ${intervalMs}ms`);
    setInterval(() => {
      this.checkAll().catch((err) => logger.error({ err }, 'Background health check failed'));
    }, intervalMs);
    // Initial check
    this.checkAll();
  }
}
