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
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Control characters
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
export const sanitizeCMRTData = (data: any): any => {
  if (!data || typeof data !== 'object') {
    throw new ValidationError('Ungültige CMRT-Daten bereitgestellt');
  }
  
  return {
    metal: sanitizeString(data.metal || ''),
    smelterName: sanitizeString(data.smelterName || ''),
    smelterCountry: sanitizeString(data.smelterCountry || ''),
    smelterIdentificationNumber: sanitizeString(data.smelterIdentificationNumber || ''),
  };
};

/**
 * Secure database query wrapper with error handling and logging
 */
export class SecureDatabase {
  private static logError(operation: string, error: any, context?: any): void {
    // Log error without exposing sensitive data
    const errorInfo = {
      operation,
      timestamp: new Date().toISOString(),
      errorCode: error?.code,
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
    context?: any
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
  static async executeTransaction<T>(
    operations: Array<() => Promise<any>>,
    transactionName: string
  ): Promise<T[]> {
    // Note: Supabase doesn't support client-side transactions directly
    // We'll implement a compensation pattern for rollback
    const results: any[] = [];
    const completedOperations: Array<() => Promise<void>> = [];
    
    try {
      for (const operation of operations) {
        const result = await operation();
        results.push(result);
        
        // Store rollback operation if available
        if (result && typeof result.rollback === 'function') {
          completedOperations.push(result.rollback);
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
  comparisonSettings: (settings: any): void => {
    if (!settings || typeof settings !== 'object') {
      throw new ValidationError('Ungültige Vergleichseinstellungen');
    }
    
    if (!Array.isArray(settings.standards) || settings.standards.length === 0) {
      throw new ValidationError('Standards müssen als nicht-leeres Array bereitgestellt werden');
    }
    
    if (!Array.isArray(settings.metals) || settings.metals.length === 0) {
      throw new ValidationError('Metalle müssen als nicht-leeres Array bereitgestellt werden');
    }
    
    // Validate individual items
    settings.standards.forEach((std: any, index: number) => {
      if (typeof std !== 'string' || std.length === 0) {
        throw new ValidationError(`Standard bei Index ${index} ist ungültig`);
      }
    });
    
    settings.metals.forEach((metal: any, index: number) => {
      if (typeof metal !== 'string' || metal.length === 0) {
        throw new ValidationError(`Metall bei Index ${index} ist ungültig`);
      }
    });
  },
  
  /**
   * Validates CMRT data array before processing
   */
  cmrtDataArray: (data: any): void => {
    if (!Array.isArray(data)) {
      throw new ValidationError('CMRT-Daten müssen als Array bereitgestellt werden');
    }
    
    if (data.length === 0) {
      throw new ValidationError('CMRT-Daten-Array darf nicht leer sein');
    }
    
    if (data.length > 10000) {
      throw new ValidationError('CMRT-Daten-Array ist zu groß (Maximum: 10.000 Einträge)');
    }
    
    data.forEach((item: any, index: number) => {
      if (!item || typeof item !== 'object') {
        throw new ValidationError(`CMRT-Dateneintrag bei Index ${index} ist ungültig`);
      }
      
      if (!item.metal || typeof item.metal !== 'string') {
        throw new ValidationError(`Metall bei Index ${index} ist erforderlich und muss ein String sein`);
      }
      
      if (!item.smelterName || typeof item.smelterName !== 'string') {
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
  logEvent: (event: string, details?: any): void => {
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
  logFileUploadEvent: (fileName: string, event: string, details?: any): void => {
    securityAudit.logEvent('file_upload_security', {
      fileName: fileName.substring(0, 20) + '...',
      event,
      details
    });
    auditLogger.logFileUpload(fileName, details?.fileSize || 0, { event, ...details }).catch(console.error);
  }
};