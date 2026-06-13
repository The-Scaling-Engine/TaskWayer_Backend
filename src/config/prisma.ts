import { PrismaClient } from '@prisma/client';
import { env } from './env';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

const isDev = env.NODE_ENV !== 'production';

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: isDev ? ['query', 'info', 'warn', 'error'] : ['warn', 'error'],
  });

if (env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export default prisma;
