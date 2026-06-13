import pino from 'pino';
import { env } from './env';

const isDev = env.NODE_ENV !== 'production';

// Cast to Logger<string> so pino-http's `logger` option types check correctly.
// Safe at runtime: Logger<never> and Logger<string> have identical behaviour
// when no custom levels are defined — only the index signature differs.
const logger: pino.Logger<string> = isDev
  ? (pino({
      level: 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      },
    }) as pino.Logger<string>)
  : (pino({ level: 'info' }, pino.destination({ sync: false })) as pino.Logger<string>);

export default logger;
