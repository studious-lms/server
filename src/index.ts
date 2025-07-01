import express from 'express';
import type { Request, Response } from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from './routers/_app';
import { createTRPCContext, createCallerFactory } from './trpc';
import { logger } from './utils/logger';
import { setupSocketHandlers } from './socket/handlers';

dotenv.config();

const app = express();

// CORS middleware
app.use(cors({
  origin: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  credentials: true,
}));

// Response time logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('Request completed', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`
    });
  });
  next();
});

// Create HTTP server
const httpServer = createServer(app);

// Setup Socket.IO
const io = new Server(httpServer, {
  cors: {
    origin: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
    allowedHeaders: ['Access-Control-Allow-Origin']
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000,
  pingInterval: 25000,
  connectTimeout: 45000,
  path: '/socket.io/',
  allowEIO3: true
});

// Add server-level logging
io.engine.on('connection_error', (err) => {
  logger.error('Socket connection error', { error: err.message });
});

// Setup socket handlers
setupSocketHandlers(io);

// Create caller
const createCaller = createCallerFactory(appRouter);

// Setup tRPC middleware
app.use(
  '/trpc',
  createExpressMiddleware({
    router: appRouter,
    createContext: async ({ req, res }: { req: Request; res: Response }) => {
      return createTRPCContext({ req, res });
    },
  })
);

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`, { 
    port: PORT,
    services: ['tRPC', 'Socket.IO']
  });
}); 

// log all env variables
logger.info('Configurations', {
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  LOG_MODE: process.env.LOG_MODE,
});