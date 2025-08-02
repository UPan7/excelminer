import { supabase } from '@/integrations/supabase/client';
import { DatabaseError, ValidationError } from '@/types/errors';
import { PostgrestError } from '@supabase/supabase-js';

/**
 * Input sanitization utilities for database operations
 */

/**
 * Sanitizes string input to prevent injection attacks
 */
export const sanitizeString = (input: string): string => {
  if (typeof input !== 'string') {
    return '';
  }
  
  // Remove potential SQL injection patterns and control characters
  return input
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '') // Control characters
    .replace(/[;'"\\]/g, '') // Basic SQL injection characters
    .trim()
    .substring(0, 1000); // Limit length
};

/**
 * Sanitizes array of strings
 */
export const sanitizeStringArray = (input: string[]): string[] => {
  if (!Array.isArray(input)) {
    return [];
  }
  
  return input
    .filter(item => typeof item === 'string')
    .map(sanitizeString)
    .filter(item => item.length > 0)
    .slice(0, 100); // Limit array size
};

/**
 * Validates and sanitizes comparison settings
 */
export const sanitizeComparisonSettings = (settings: {
  standards?: string[];
  metals?: string[];
}): { standards: string[]; metals: string[] } => {
  const allowedStandards = ['CMRT', 'EMRT', 'AMRT'];
  const allowedMetals = ['Gold', 'Tin', 'Tantalum', 'Tungsten'];
  
  const sanitizedStandards = sanitizeStringArray(settings.standards || [])
    .filter(std => allowedStandards.includes(std));
  
  const sanitizedMetals = sanitizeStringArray(settings.metals || [])
    .filter(metal => allowedMetals.includes(metal));
  
  return {
    standards: sanitizedStandards,
    metals: sanitizedMetals
  };
};

/**
 * Sanitizes CMRT data for database operations
 */
export const sanitizeCMRTData = (data: unknown): Record<string, string> => {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('Ungültige CMRT-Daten bereitgestellt');
  }
  
  const dataObj = data as Record<string, unknown>;
  
  return {
    metal: sanitizeString(String(dataObj.metal || '')),
    smelterName: sanitizeString(String(dataObj.smelterName || '')),
    smelterCountry: sanitizeString(String(dataObj.smelterCountry || '')),
    smelterIdentificationNumber: sanitizeString(String(dataObj.smelterIdentificationNumber || '')),
  };
};

/**
 * Secure database query wrapper with error handling and logging
 */
export class SecureDatabase {
  private static logError(operation: string, error: unknown, context?: Record<string, unknown>): void {
    // Log error without exposing sensitive data
    const errorInfo = {
      operation,
      timestamp: new Date().toISOString(),
      errorCode: error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : 'unknown',
      context: context ? { ...context, sensitiveData: '[REDACTED]' } : undefined
    };
    
    // In development, log more details
    if (process.env.NODE_ENV === 'development') {
      console.error('Database operation failed:', errorInfo, error);
    } else {
      // In production, log safely
      console.error('Database operation failed:', errorInfo);
    }
  }
  
  /**
   * Executes a secure query with automatic error handling and conversion
   */
  static async executeQuery<T>(
    operation: string,
    queryFn: () => Promise<{ data: T; error: PostgrestError | null }>,
    context?: Record<string, unknown>
  ): Promise<T> {
    try {
      const { data, error } = await queryFn();
      
      if (error) {
        this.logError(operation, error, context);
        throw this.convertPostgrestError(error);
      }
      
      return data;
    } catch (error) {
      if (error instanceof DatabaseError || error instanceof ValidationError) {
        throw error;
      }
      
      this.logError(operation, error, context);
      throw new DatabaseError(
        'Ein Datenbankfehler ist aufgetreten. Bitte versuchen Sie es später erneut.',
        { operation }
      );
    }
  }
  
  /**
   * Executes a transaction with automatic rollback on error
   */
  static async executeTransaction(
    operations: Array<() => Promise<unknown>>,
    transactionName: string
  ): Promise<unknown[]> {
    // Note: Supabase doesn't support client-side transactions directly
    // We'll implement a compensation pattern for rollback
    const results: unknown[] = [];
    const completedOperations: Array<() => Promise<void>> = [];
    
    try {
      for (const operation of operations) {
        const result = await operation();
        results.push(result);
        
        // Store rollback operation if available
        if (result && typeof result === 'object' && 'rollback' in result && typeof (result as any).rollback === 'function') {
          completedOperations.push((result as any).rollback);
        }
      }
      
      return results;
    } catch (error) {
      this.logError(transactionName, error);
      
      // Attempt to rollback completed operations
      for (const rollback of completedOperations.reverse()) {
        try {
          await rollback();
        } catch (rollbackError) {
          this.logError(`${transactionName}_rollback`, rollbackError);
        }
      }
      
      throw new DatabaseError(
        'Transaktion fehlgeschlagen und wurde rückgängig gemacht.',
        { transaction: transactionName }
      );
    }
  }
  
  /**
   * Safely fetches reference data with input validation
   */
  static async fetchReferenceData(settings: {
    standards: string[];
    metals: string[];
  }) {
    const sanitizedSettings = sanitizeComparisonSettings(settings);
    
    if (sanitizedSettings.standards.length === 0) {
      throw new ValidationError('Mindestens ein Standard muss ausgewählt werden');
    }
    
    if (sanitizedSettings.metals.length === 0) {
      throw new ValidationError('Mindestens ein Metall muss ausgewählt werden');
    }
    
    return this.executeQuery(
      'fetchReferenceData',
      async () => {
        const { data, error } = await supabase
          .from('reference_facilities')
          .select('*, list_type')
          .in('list_type', sanitizedSettings.standards)
          .in('metal', sanitizedSettings.metals)
          .not('standard_smelter_name', 'is', null);
        return { data, error };
      },
      { standards: sanitizedSettings.standards, metals: sanitizedSettings.metals }
    );
  }
  
  /**
   * Safely fetches database statistics
   */
  static async fetchDatabaseStats() {
    return this.executeQuery(
      'fetchDatabaseStats',
      async () => {
        const { data, error } = await supabase.rpc('get_reference_stats');
        return { data, error };
      }
    );
  }
  
  /**
   * Safely fetches available metals
   */
  static async fetchAvailableMetals() {
    return this.executeQuery(
      'fetchAvailableMetals',
      async () => {
        const { data, error } = await supabase
          .from('reference_facilities')
          .select('metal', { count: 'exact' })
          .not('metal', 'is', null)
          .order('metal');
        return { data, error };
      }
    );
  }
  
  /**
   * Converts Supabase PostgrestError to our custom DatabaseError
   */
  private static convertPostgrestError(error: PostgrestError): DatabaseError {
    // Don't expose internal error details in production
    const safeMessage = process.env.NODE_ENV === 'development' 
      ? error.message 
      : 'Ein Datenbankfehler ist aufgetreten';
    
    return new DatabaseError(safeMessage, {
      code: error.code,
      hint: process.env.NODE_ENV === 'development' ? error.hint : undefined
    });
  }
}

/**
 * Input validation middleware for database operations
 */
export const validateDatabaseInput = {
  /**
   * Validates comparison settings before database queries
   */
  comparisonSettings: (settings: unknown): void => {
    if (!settings || typeof settings !== 'object') {
      throw new ValidationError('Ungültige Vergleichseinstellungen');
    }
    
    const settingsObj = settings as Record<string, unknown>;
    
    if (!Array.isArray(settingsObj.standards) || settingsObj.standards.length === 0) {
      throw new ValidationError('Standards müssen als nicht-leeres Array bereitgestellt werden');
    }
    
    if (!Array.isArray(settingsObj.metals) || settingsObj.metals.length === 0) {
      throw new ValidationError('Metalle müssen als nicht-leeres Array bereitgestellt werden');
    }
    
    // Validate individual items
    (settingsObj.standards as unknown[]).forEach((std: unknown, index: number) => {
      if (typeof std !== 'string' || std.length === 0) {
        throw new ValidationError(`Standard bei Index ${index} ist ungültig`);
      }
    });
    
    (settingsObj.metals as unknown[]).forEach((metal: unknown, index: number) => {
      if (typeof metal !== 'string' || metal.length === 0) {
        throw new ValidationError(`Metall bei Index ${index} ist ungültig`);
      }
    });
  },
  
  /**
   * Validates CMRT data array before processing
   */
  cmrtDataArray: (data: unknown): void => {
    if (!Array.isArray(data)) {
      throw new ValidationError('CMRT-Daten müssen als Array bereitgestellt werden');
    }
    
    if (data.length === 0) {
      throw new ValidationError('CMRT-Daten-Array darf nicht leer sein');
    }
    
    if (data.length > 10000) {
      throw new ValidationError('CMRT-Daten-Array ist zu groß (Maximum: 10.000 Einträge)');
    }
    
    data.forEach((item: unknown, index: number) => {
      if (!item || typeof item !== 'object') {
        throw new ValidationError(`CMRT-Dateneintrag bei Index ${index} ist ungültig`);
      }
      
      const itemObj = item as Record<string, unknown>;
      
      if (!itemObj.metal || typeof itemObj.metal !== 'string') {
        throw new ValidationError(`Metall bei Index ${index} ist erforderlich und muss ein String sein`);
      }
      
      if (!itemObj.smelterName || typeof itemObj.smelterName !== 'string') {
        throw new ValidationError(`Schmelzerei-Name bei Index ${index} ist erforderlich und muss ein String sein`);
      }
    });
  }
};

/**
 * Security audit logging
 */
// Import audit logger for database persistence
import { auditLogger } from './auditLogger';

export const securityAudit = {
  /**
   * Logs security-relevant events (enhanced with database persistence)
   */
  logEvent: (event: string, details?: Record<string, unknown>): void => {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      event,
      details: details ? { ...details, sensitiveData: '[REDACTED]' } : undefined,
      userAgent: typeof window !== 'undefined' ? window.navigator.userAgent : 'unknown'
    };
    
    // Console logging for development
    if (process.env.NODE_ENV === 'development') {
      console.log('Security Audit:', auditEntry);
    }
    
    // Also persist to database
    auditLogger.logSecurityEvent(event, details || {}).catch(console.error);
  },
  
  /**
   * Logs failed authentication attempts
   */
  logAuthFailure: (email?: string, reason?: string): void => {
    securityAudit.logEvent('auth_failure', {
      email: email ? email.substring(0, 3) + '***' : 'unknown',
      reason
    });
    // Direct database logging for auth failures
    auditLogger.logLoginFailure(email, reason).catch(console.error);
  },
  
  /**
   * Logs rate limit violations
   */
  logRateLimitViolation: (userId?: string, operation?: string): void => {
    securityAudit.logEvent('rate_limit_violation', {
      userId: userId ? 'user_' + userId.substring(0, 8) : 'anonymous',
      operation
    });
    auditLogger.logSecurityEvent('RATE_LIMIT_VIOLATION', { userId, operation }).catch(console.error);
  },
  
  /**
   * Logs file upload security events
   */
  logFileUploadEvent: (fileName: string, event: string, details?: Record<string, unknown>): void => {
    securityAudit.logEvent('file_upload_security', {
      fileName: fileName.substring(0, 20) + '...',
      event,
      details
    });
    auditLogger.logFileUpload(fileName, typeof details?.fileSize === 'number' ? details.fileSize : 0, { event, ...details }).catch(console.error);
  }
};