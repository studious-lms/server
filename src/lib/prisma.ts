import { PrismaClient } from '@prisma/client';
import { env } from './config/env.js';

const prismaClientSingleton = () => {
  return new PrismaClient({
    log: env.NODE_ENV === 'development' 
      ? ['query', 'error', 'warn'] 
      : ['error'],
  });
};

// Prevent multiple instances of Prisma Client in development
declare global {
  var prisma: undefined | ReturnType<typeof prismaClientSingleton>;
}

export const prisma = globalThis.prisma ?? prismaClientSingleton();

if (env.NODE_ENV !== 'production') {
  globalThis.prisma = prisma;
}

process.on('beforeExit', async () => {
  await prisma.$disconnect();
});