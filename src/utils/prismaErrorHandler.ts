import { 
  PrismaClientKnownRequestError, 
  PrismaClientUnknownRequestError, 
  PrismaClientValidationError 
} from '@prisma/client/runtime/library';

export interface PrismaErrorInfo {
  message: string;
  code?: string;
  meta?: any;
  details?: string;
}

export function handlePrismaError(error: unknown): PrismaErrorInfo {
  // PrismaClientKnownRequestError - Database constraint violations, etc.
  if (error instanceof PrismaClientKnownRequestError) {
    return handleKnownRequestError(error);
  }
  
  // PrismaClientValidationError - Invalid data format, missing required fields, etc.
  if (error instanceof PrismaClientValidationError) {
    return handleValidationError(error);
  }
  
  // PrismaClientUnknownRequestError - Unknown database errors
  if (error instanceof PrismaClientUnknownRequestError) {
    return handleUnknownRequestError(error);
  }
  
  // Generic error fallback
  if (error instanceof Error) {
    return {
      message: error.message,
      details: error.stack
    };
  }
  
  return {
    message: 'An unknown database error occurred',
    details: String(error)
  };
}

function handleKnownRequestError(error: PrismaClientKnownRequestError): PrismaErrorInfo {
  const { code, meta, message } = error;
  
  switch (code) {
    case 'P2002':
      const target = Array.isArray(meta?.target) ? meta.target.join(', ') : meta?.target || 'field';
      return {
        message: `A record with this ${target} already exists`,
        code,
        meta,
        details: `Unique constraint violation on ${target}`
      };
      
    case 'P2003':
      const fieldName = meta?.field_name || 'related field';
      return {
        message: `Cannot delete this record because it's referenced by other records`,
        code,
        meta,
        details: `Foreign key constraint violation on ${fieldName}`
      };
      
    case 'P2025':
      return {
        message: 'The record you are trying to update or delete does not exist',
        code,
        meta,
        details: 'Record not found in database'
      };
      
    case 'P2014':
      return {
        message: 'The change you are trying to make would violate the required relationship',
        code,
        meta,
        details: 'Required relation violation'
      };
      
    case 'P2011':
      return {
        message: 'A required field is missing or empty',
        code,
        meta,
        details: 'Null constraint violation'
      };
      
    case 'P2012':
      return {
        message: 'The data you provided is not in the correct format',
        code,
        meta,
        details: 'Data validation error'
      };
      
    case 'P2013':
      return {
        message: 'The data you provided is too long for this field',
        code,
        meta,
        details: 'String length constraint violation'
      };
      
    case 'P2015':
      return {
        message: 'The record you are looking for could not be found',
        code,
        meta,
        details: 'Record not found'
      };
      
    case 'P2016':
      return {
        message: 'The query you are trying to execute is not valid',
        code,
        meta,
        details: 'Query interpretation error'
      };
      
    case 'P2017':
      return {
        message: 'The relationship between records is not properly connected',
        code,
        meta,
        details: 'Relation connection error'
      };
      
    case 'P2018':
      return {
        message: 'The connected record you are looking for does not exist',
        code,
        meta,
        details: 'Connected record not found'
      };
      
    case 'P2019':
      return {
        message: 'The input you provided is not valid',
        code,
        meta,
        details: 'Input error'
      };
      
    case 'P2020':
      return {
        message: 'The value you provided is outside the allowed range',
        code,
        meta,
        details: 'Value out of range'
      };
      
    case 'P2021':
      return {
        message: 'The table you are trying to access does not exist',
        code,
        meta,
        details: 'Table does not exist'
      };
      
    case 'P2022':
      return {
        message: 'The column you are trying to access does not exist',
        code,
        meta,
        details: 'Column does not exist'
      };
      
    case 'P2023':
      return {
        message: 'The column data is not valid',
        code,
        meta,
        details: 'Column data validation error'
      };
      
    case 'P2024':
      return {
        message: 'The database connection pool is exhausted',
        code,
        meta,
        details: 'Connection pool timeout'
      };
      
    case 'P2026':
      return {
        message: 'The current database provider does not support this feature',
        code,
        meta,
        details: 'Feature not supported by database provider'
      };
      
    case 'P2027':
      return {
        message: 'Multiple errors occurred during the database operation',
        code,
        meta,
        details: 'Multiple errors in query execution'
      };
      
    default:
      return {
        message: 'A database constraint was violated',
        code,
        meta,
        details: message
      };
  }
}

function handleValidationError(error: PrismaClientValidationError): PrismaErrorInfo {
  return {
    message: 'The data you provided is not valid',
    details: error.message,
    meta: {
      type: 'validation_error',
      originalMessage: error.message
    }
  };
}

function handleUnknownRequestError(error: PrismaClientUnknownRequestError): PrismaErrorInfo {
  return {
    message: 'An unexpected database error occurred',
    details: error.message,
    meta: {
      type: 'unknown_request_error',
      originalMessage: error.message
    }
  };
}

// Helper function to get user-friendly field names
export function getFieldDisplayName(fieldName: string): string {
  const fieldMap: Record<string, string> = {
    'username': 'username',
    'email': 'email address',
    'password': 'password',
    'name': 'name',
    'title': 'title',
    'content': 'content',
    'description': 'description',
    'subject': 'subject',
    'section': 'section',
    'color': 'color',
    'location': 'location',
    'startTime': 'start time',
    'endTime': 'end time',
    'dueDate': 'due date',
    'maxGrade': 'maximum grade',
    'grade': 'grade',
    'feedback': 'feedback',
    'remarks': 'remarks',
    'syllabus': 'syllabus',
    'path': 'file path',
    'size': 'file size',
    'type': 'file type',
    'uploadedAt': 'upload date',
    'verified': 'verification status',
    'profileId': 'profile',
    'schoolId': 'school',
    'classId': 'class',
    'assignmentId': 'assignment',
    'submissionId': 'submission',
    'userId': 'user',
    'eventId': 'event',
    'sessionId': 'session',
    'thumbnailId': 'thumbnail',
    'annotationId': 'annotation',
    'logoId': 'logo'
  };
  
  return fieldMap[fieldName] || fieldName;
} 