import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function createLogger(module: string) {
  return logger.child({ module });
}

export default logger;
