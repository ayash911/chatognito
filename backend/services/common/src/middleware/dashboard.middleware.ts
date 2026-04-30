import type { Request, Response, NextFunction } from 'express';
import { redis } from '../db/redis';

export interface DashboardLog {
  service: string;
  method: string;
  path: string;
  status: number;
  latency: number;
  timestamp: string;
  data?: any;
}

export const dashboardLogger = (serviceName: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    // Patch end to capture response
    const oldEnd = res.end;
    res.end = function (chunk?: any, encoding?: any, cb?: any) {
      const latency = Date.now() - start;

      let responseBody;
      if (chunk) {
        try {
          responseBody = JSON.parse(chunk.toString('utf8'));
        } catch {
          responseBody = chunk.toString('utf8').substring(0, 1000); // cap length
        }
      }

      const log: any = {
        service: serviceName,
        method: req.method,
        path: req.url,
        status: res.statusCode,
        latency,
        timestamp: new Date().toISOString(),
      };

      if (req.url !== '/health' && !req.url.includes('health')) {
        if (req.body && Object.keys(req.body).length > 0) log.data = req.body;
        if (req.query && Object.keys(req.query).length > 0) log.query = req.query;
        if (responseBody) log.response = responseBody;
      }

      // Publish to Redis
      redis.publish('chatognito:dashboard:logs', JSON.stringify(log)).catch(() => {}); // Silently fail if redis is down

      return oldEnd.call(this, chunk, encoding, cb);
    };

    next();
  };
};
