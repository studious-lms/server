import { TRPCError } from '@trpc/server';
import { handlePrismaError } from './prismaErrorHandler';

export async function withPrismaErrorHandling<T>(
  operation: () => Promise<T>,
  context: string = 'database operation'
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const prismaErrorInfo = handlePrismaError(error);
    
    // Log the detailed error for debugging
    console.error(`Prisma error in ${context}:`, {
      userMessage: prismaErrorInfo.message,
      details: prismaErrorInfo.details,
      code: prismaErrorInfo.code,
      meta: prismaErrorInfo.meta,
      originalError: error
    });

    // Throw a tRPC error with the user-friendly message
    throw new TRPCError({
      code: getTRPCCode(prismaErrorInfo.code),
      message: prismaErrorInfo.message,
      cause: error
    });
  }
}

function getTRPCCode(prismaCode?: string): TRPCError['code'] {
  if (!prismaCode) return 'INTERNAL_SERVER_ERROR';
  
  // Map Prisma error codes to tRPC error codes
  const codeMap: Record<string, TRPCError['code']> = {
    'P2002': 'CONFLICT',        // Unique constraint violation
    'P2003': 'BAD_REQUEST',     // Foreign key constraint violation
    'P2025': 'NOT_FOUND',       // Record not found
    'P2014': 'BAD_REQUEST',     // Required relation violation
    'P2011': 'BAD_REQUEST',     // Null constraint violation
    'P2012': 'BAD_REQUEST',     // Data validation error
    'P2013': 'BAD_REQUEST',     // String length constraint violation
    'P2015': 'NOT_FOUND',       // Record not found
    'P2016': 'BAD_REQUEST',     // Query interpretation error
    'P2017': 'BAD_REQUEST',     // Relation connection error
    'P2018': 'NOT_FOUND',       // Connected record not found
    'P2019': 'BAD_REQUEST',     // Input error
    'P2020': 'BAD_REQUEST',     // Value out of range
    'P2021': 'INTERNAL_SERVER_ERROR', // Table does not exist
    'P2022': 'INTERNAL_SERVER_ERROR', // Column does not exist
    'P2023': 'BAD_REQUEST',     // Column data validation error
    'P2024': 'INTERNAL_SERVER_ERROR', // Connection pool timeout
    'P2026': 'INTERNAL_SERVER_ERROR', // Feature not supported
    'P2027': 'INTERNAL_SERVER_ERROR', // Multiple errors
  };
  
  return codeMap[prismaCode] || 'INTERNAL_SERVER_ERROR';
}

// Convenience functions for common operations
export const prismaWrapper = {
  findUnique: <T>(operation: () => Promise<T | null>, context?: string) =>
    withPrismaErrorHandling(operation, context),
    
  findFirst: <T>(operation: () => Promise<T | null>, context?: string) =>
    withPrismaErrorHandling(operation, context),
    
  findMany: <T>(operation: () => Promise<T[]>, context?: string) =>
    withPrismaErrorHandling(operation, context),
    
  create: <T>(operation: () => Promise<T>, context?: string) =>
    withPrismaErrorHandling(operation, context),
    
  update: <T>(operation: () => Promise<T>, context?: string) =>
    withPrismaErrorHandling(operation, context),
    
  delete: <T>(operation: () => Promise<T>, context?: string) =>
    withPrismaErrorHandling(operation, context),
    
  deleteMany: <T>(operation: () => Promise<T>, context?: string) =>
    withPrismaErrorHandling(operation, context),
    
  upsert: <T>(operation: () => Promise<T>, context?: string) =>
    withPrismaErrorHandling(operation, context),
    
  count: <T>(operation: () => Promise<T>, context?: string) =>
    withPrismaErrorHandling(operation, context),
    
  aggregate: <T>(operation: () => Promise<T>, context?: string) =>
    withPrismaErrorHandling(operation, context),
}; 