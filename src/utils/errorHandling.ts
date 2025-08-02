import { toast } from '@/hooks/use-toast';
import { 
  ExcelMinerError, 
  FileParsingError, 
  ValidationError, 
  DatabaseError, 
  NetworkError, 
  AuthenticationError,
  ComparisonError,
  isExcelMinerError 
} from '@/types/errors';

// Shared maximum file size constant
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Enhanced toast notifications for different error types
export const showErrorToast = (error: Error | ExcelMinerError, options?: {
  title?: string;
  description?: string;
  showRetry?: boolean;
  onRetry?: () => void;
}) => {
  const isCustomError = isExcelMinerError(error);
  
  // Default titles based on error type
  let defaultTitle = 'Fehler aufgetreten';
  if (error instanceof FileParsingError) defaultTitle = 'Datei-Verarbeitungsfehler';
  else if (error instanceof ValidationError) defaultTitle = 'Eingabefehler';
  else if (error instanceof DatabaseError) defaultTitle = 'Datenbankfehler';
  else if (error instanceof NetworkError) defaultTitle = 'Verbindungsfehler';
  else if (error instanceof AuthenticationError) defaultTitle = 'Anmeldefehler';
  else if (error instanceof ComparisonError) defaultTitle = 'Vergleichsfehler';

  const title = options?.title || defaultTitle;
  const description = options?.description || error.message;

  toast({
    title,
    description,
    variant: 'destructive',
    // Note: Custom retry action would need proper React component setup
  });

  // Log to console for development
  if (process.env.NODE_ENV === 'development') {
    console.error('Error caught by error handler:', {
      error,
      isCustomError,
      code: isCustomError ? (error as ExcelMinerError).code : undefined,
      details: isCustomError ? (error as ExcelMinerError).details : undefined,
    });
  }
};

// Success toast helper
export const showSuccessToast = (title: string, description?: string) => {
  toast({
    title,
    description,
  });
};

// Info toast helper
export const showInfoToast = (title: string, description?: string) => {
  toast({
    title,
    description,
    variant: 'default',
  });
};

// Warning toast helper
export const showWarningToast = (title: string, description?: string) => {
  toast({
    title,
    description,
    variant: 'destructive', // Using destructive as warning variant doesn't exist
  });
};

// Error handler wrapper for async functions
export const withErrorHandling = <T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  errorContext?: string
) => {
  return async (...args: T): Promise<R | null> => {
    try {
      return await fn(...args);
    } catch (error) {
      const contextMessage = errorContext ? ` in ${errorContext}` : '';
      
      if (isExcelMinerError(error)) {
        showErrorToast(error);
      } else if (error instanceof Error) {
        showErrorToast(new ExcelMinerError(
          `${error.message}${contextMessage}`,
          'UNKNOWN_ERROR',
          { originalError: error.message, context: errorContext }
        ));
      } else {
        showErrorToast(new ExcelMinerError(
          `Unbekannter Fehler aufgetreten${contextMessage}`,
          'UNKNOWN_ERROR',
          { context: errorContext }
        ));
      }
      
      return null;
    }
  };
};

// Error handler for sync functions
export const withSyncErrorHandling = <T extends unknown[], R>(
  fn: (...args: T) => R,
  errorContext?: string
) => {
  return (...args: T): R | null => {
    try {
      return fn(...args);
    } catch (error) {
      const contextMessage = errorContext ? ` in ${errorContext}` : '';
      
      if (isExcelMinerError(error)) {
        showErrorToast(error);
      } else if (error instanceof Error) {
        showErrorToast(new ExcelMinerError(
          `${error.message}${contextMessage}`,
          'UNKNOWN_ERROR',
          { originalError: error.message, context: errorContext }
        ));
      } else {
        showErrorToast(new ExcelMinerError(
          `Unbekannter Fehler aufgetreten${contextMessage}`,
          'UNKNOWN_ERROR',
          { context: errorContext }
        ));
      }
      
      return null;
    }
  };
};

// Supabase error converter
export const convertSupabaseError = (error: any): DatabaseError => {
  const message = error?.message || 'Datenbankfehler aufgetreten';
  const details = {
    code: error?.code,
    details: error?.details,
    hint: error?.hint,
    originalError: error
  };
  
  return new DatabaseError(message, details);
};

// Network error converter
export const convertNetworkError = (error: any): NetworkError => {
  const message = error?.message || 'Netzwerkfehler aufgetreten';
  const details = {
    status: error?.status,
    statusText: error?.statusText,
    url: error?.config?.url,
    originalError: error
  };
  
  return new NetworkError(message, details);
};

// File validation helper
export const validateFileType = (file: File): void => {
  const allowedTypes = [
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv'
  ];
  
  if (!allowedTypes.includes(file.type)) {
    throw new FileParsingError(
      'Ungültiger Dateityp. Nur Excel- (.xlsx, .xls) und CSV-Dateien sind erlaubt.',
      { fileName: file.name, fileType: file.type, allowedTypes }
    );
  }
  
  // Check file size using shared limit
  if (file.size > MAX_FILE_SIZE) {
    throw new FileParsingError(
      `Datei ist zu groß. Maximale Dateigröße ist ${(MAX_FILE_SIZE / (1024 * 1024)).toFixed(0)}MB.`,
      { fileName: file.name, fileSize: file.size, maxSize: MAX_FILE_SIZE }
    );
  }
};