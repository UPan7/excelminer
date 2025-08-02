// Custom error classes for ExcelMiner application

export class ExcelMinerError extends Error {
  public readonly code: string;
  public readonly details?: Record<string, any>;

  constructor(message: string, code: string, details?: Record<string, any>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
  }
}

export class FileParsingError extends ExcelMinerError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'FILE_PARSING_ERROR', details);
  }
}

export class ValidationError extends ExcelMinerError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'VALIDATION_ERROR', details);
  }
}

export class DatabaseError extends ExcelMinerError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'DATABASE_ERROR', details);
  }
}

export class NetworkError extends ExcelMinerError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'NETWORK_ERROR', details);
  }
}

export class AuthenticationError extends ExcelMinerError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'AUTHENTICATION_ERROR', details);
  }
}

export class ComparisonError extends ExcelMinerError {
  constructor(message: string, details?: Record<string, any>) {
    super(message, 'COMPARISON_ERROR', details);
  }
}

// Error type guards
export const isExcelMinerError = (error: unknown): error is ExcelMinerError => {
  return error instanceof ExcelMinerError;
};

export const isFileParsingError = (error: unknown): error is FileParsingError => {
  return error instanceof FileParsingError;
};

export const isValidationError = (error: unknown): error is ValidationError => {
  return error instanceof ValidationError;
};

export const isDatabaseError = (error: unknown): error is DatabaseError => {
  return error instanceof DatabaseError;
};

export const isNetworkError = (error: unknown): error is NetworkError => {
  return error instanceof NetworkError;
};

export const isAuthenticationError = (error: unknown): error is AuthenticationError => {
  return error instanceof AuthenticationError;
};

export const isComparisonError = (error: unknown): error is ComparisonError => {
  return error instanceof ComparisonError;
};