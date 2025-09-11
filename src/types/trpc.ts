import { inferAsyncReturnType } from '@trpc/server';
import { createTRPCContext } from '../trpc.js';

export type Context = inferAsyncReturnType<typeof createTRPCContext> & {
  isTeacher?: boolean;
  teacherClassIds?: string[];
};

export interface MiddlewareContext {
  ctx: Context;
  next: (opts?: { ctx: Partial<Context> }) => Promise<any>;
  input?: any;
  path?: string;
  type?: string;
} 