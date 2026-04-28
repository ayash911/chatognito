import pino from 'pino';
import pinoHttp from 'pino-http';

const isEnabled = process.env.LOG_ENABLED !== 'false';
const logLevel = process.env.LOG_LEVEL || 'info';

export const logger = pino({
  enabled: isEnabled,
  level: logLevel,
  transport:
    process.env.NODE_ENV !== 'production'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            ignore: 'pid,hostname,req,res,responseTime,reqId,time', // Hide time as well
          },
        }
      : undefined,
});

export const httpLogger = pinoHttp({
  logger,
  autoLogging: {
    ignore: (req) => req.url === '/health' || req.url === '/favicon.ico',
  },
  customSuccessMessage: (req, res) => {
    return `HTTP ${req.method} ${req.url} -> ${res.statusCode}`;
  },
  customErrorMessage: (req, _res, err) => {
    return `HTTP ${req.method} ${req.url} -> ERROR: ${err.message}`;
  },
});
