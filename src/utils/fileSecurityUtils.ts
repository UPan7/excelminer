import { FileParsingError, ValidationError } from '@/types/errors';

// File signature magic numbers for validation
const FILE_SIGNATURES = {
  // Excel formats
  XLSX: [0x50, 0x4B, 0x03, 0x04], // ZIP-based (XLSX)
  XLS: [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1], // OLE2 (XLS)
  
  // CSV (text-based, we'll check for common text patterns)
  CSV_UTF8: [0xEF, 0xBB, 0xBF], // UTF-8 BOM (optional)
} as const;

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

// Rate limiting storage
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour in milliseconds
const MAX_UPLOADS_PER_HOUR = 500;

/**
 * Validates file signature using magic numbers
 */
export const validateFileSignature = async (file: File): Promise<void> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const buffer = e.target?.result as ArrayBuffer;
        if (!buffer) {
          throw new FileParsingError('Datei konnte nicht gelesen werden');
        }
        
        const bytes = new Uint8Array(buffer.slice(0, 8)); // Read first 8 bytes
        const extension = getFileExtension(file.name).toLowerCase();
        
        let isValid = false;
        
        if (extension === '.xlsx') {
          // Check for ZIP signature (XLSX files are ZIP archives)
          isValid = checkSignature(bytes, FILE_SIGNATURES.XLSX);
        } else if (extension === '.xls') {
          // Check for OLE2 signature
          isValid = checkSignature(bytes, FILE_SIGNATURES.XLS);
        } else if (extension === '.csv') {
          // For CSV, check if it's text-based (more permissive)
          isValid = isTextFile(bytes) || checkSignature(bytes, FILE_SIGNATURES.CSV_UTF8);
        }
        
        if (!isValid) {
          throw new FileParsingError(
            `Datei ${file.name} hat eine ungültige Signatur. Die Datei entspricht nicht dem erwarteten Format ${extension}.`,
            { 
              fileName: file.name,
              expectedExtension: extension,
              detectedSignature: Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ')
            }
          );
        }
        
        resolve();
      } catch (error) {
        reject(error instanceof FileParsingError ? error : new FileParsingError(
          `Fehler bei der Validierung der Dateisignatur: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`
        ));
      }
    };
    
    reader.onerror = () => {
      reject(new FileParsingError('Fehler beim Lesen der Datei für Signaturvalidierung'));
    };
    
    // Read first 8 bytes for signature check
    reader.readAsArrayBuffer(file.slice(0, 8));
  });
};

/**
 * Checks if bytes match a specific signature
 */
const checkSignature = (bytes: Uint8Array, signature: readonly number[]): boolean => {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
};

/**
 * Checks if the file appears to be a text file (for CSV validation)
 */
const isTextFile = (bytes: Uint8Array): boolean => {
  // Check if most bytes are printable ASCII or common UTF-8 characters
  let printableCount = 0;
  for (let i = 0; i < Math.min(bytes.length, 100); i++) {
    const byte = bytes[i];
    // Printable ASCII (32-126), newline (10), carriage return (13), tab (9)
    if ((byte >= 32 && byte <= 126) || byte === 10 || byte === 13 || byte === 9) {
      printableCount++;
    }
  }
  return printableCount / Math.min(bytes.length, 100) > 0.8; // 80% printable characters
};

/**
 * Sanitizes file names to prevent path traversal attacks
 */
export const sanitizeFileName = (fileName: string): string => {
  // Remove path separators and potentially dangerous characters
  const sanitized = fileName
    .replace(/[\/\\:*?"<>|]/g, '_') // Replace dangerous characters
    .replace(/\.\./g, '_') // Remove path traversal attempts
    .replace(/^\.+/, '') // Remove leading dots
    .trim();
  
  // Ensure the filename isn't empty after sanitization
  if (!sanitized || sanitized.length === 0) {
    return `upload_${Date.now()}`;
  }
  
  // Limit length to prevent issues
  const maxLength = 255;
  if (sanitized.length > maxLength) {
    const extension = getFileExtension(sanitized);
    const nameWithoutExt = sanitized.substring(0, sanitized.lastIndexOf('.') || sanitized.length);
    const truncatedName = nameWithoutExt.substring(0, maxLength - extension.length - 1);
    return truncatedName + extension;
  }
  
  return sanitized;
};

/**
 * Gets file extension safely
 */
const getFileExtension = (fileName: string): string => {
  const lastDot = fileName.lastIndexOf('.');
  return lastDot !== -1 ? fileName.substring(lastDot) : '';
};

/**
 * Validates file size with strict limits
 */
export const validateFileSize = (file: File): void => {
  if (file.size > MAX_FILE_SIZE) {
    throw new FileParsingError(
      `Datei ${file.name} ist zu groß. Maximale Dateigröße: ${(MAX_FILE_SIZE / (1024 * 1024)).toFixed(1)}MB`,
      { 
        fileName: file.name,
        fileSize: file.size,
        maxSize: MAX_FILE_SIZE 
      }
    );
  }
  
  if (file.size === 0) {
    throw new FileParsingError(
      `Datei ${file.name} ist leer`,
      { fileName: file.name }
    );
  }
};

/**
 * Validates file extension
 */
export const validateFileExtension = (file: File): void => {
  const extension = getFileExtension(file.name).toLowerCase();
  
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    throw new FileParsingError(
      `Dateiformat ${extension} wird nicht unterstützt. Erlaubte Formate: ${ALLOWED_EXTENSIONS.join(', ')}`,
      { 
        fileName: file.name,
        detectedExtension: extension,
        allowedExtensions: ALLOWED_EXTENSIONS 
      }
    );
  }
};

/**
 * Implements rate limiting for file uploads
 */
export const checkRateLimit = (userId: string): void => {
  const now = Date.now();
  const userKey = userId || 'anonymous';
  
  // Clean up expired entries
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now > entry.resetTime) {
      rateLimitMap.delete(key);
    }
  }
  
  const userEntry = rateLimitMap.get(userKey);
  
  if (!userEntry) {
    // First upload for this user
    rateLimitMap.set(userKey, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW
    });
    return;
  }
  
  if (now > userEntry.resetTime) {
    // Reset window expired
    rateLimitMap.set(userKey, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW
    });
    return;
  }
  
  if (userEntry.count >= MAX_UPLOADS_PER_HOUR) {
    const remainingTime = Math.ceil((userEntry.resetTime - now) / (60 * 1000)); // minutes
    throw new ValidationError(
      `Upload-Limit erreicht. Sie können ${MAX_UPLOADS_PER_HOUR} Dateien pro Stunde hochladen. Versuchen Sie es in ${remainingTime} Minuten erneut.`,
      { 
        currentCount: userEntry.count,
        maxCount: MAX_UPLOADS_PER_HOUR,
        remainingMinutes: remainingTime
      }
    );
  }
  
  // Increment counter
  userEntry.count += 1;
};

/**
 * Comprehensive file validation function
 */
export const validateUploadedFile = async (file: File, userId?: string): Promise<string> => {
  // 1. Rate limiting check
  if (userId) {
    checkRateLimit(userId);
  }
  
  // 2. File size validation
  validateFileSize(file);
  
  // 3. File extension validation
  validateFileExtension(file);
  
  // 4. File name sanitization
  const sanitizedName = sanitizeFileName(file.name);
  
  // 5. File signature validation
  await validateFileSignature(file);
  
  return sanitizedName;
};

/**
 * Progress tracking utility for file uploads
 */
export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
  stage: 'validating' | 'reading' | 'processing' | 'complete';
}

export type ProgressCallback = (progress: UploadProgress) => void;

/**
 * File upload with progress tracking
 */
export const uploadFileWithProgress = async (
  file: File,
  onProgress?: ProgressCallback,
  userId?: string
): Promise<{ sanitizedName: string; content: ArrayBuffer | string }> => {
  // Validation stage
  onProgress?.({
    loaded: 0,
    total: file.size,
    percentage: 0,
    stage: 'validating'
  });
  
  const sanitizedName = await validateUploadedFile(file, userId);
  
  // Reading stage
  onProgress?.({
    loaded: 0,
    total: file.size,
    percentage: 10,
    stage: 'reading'
  });
  
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const isCSV = sanitizedName.toLowerCase().endsWith('.csv');
    
    reader.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress({
          loaded: e.loaded,
          total: e.total,
          percentage: Math.round((e.loaded / e.total) * 80) + 10, // 10-90%
          stage: 'reading'
        });
      }
    };
    
    reader.onload = (e) => {
      onProgress?.({
        loaded: file.size,
        total: file.size,
        percentage: 90,
        stage: 'processing'
      });
      
      const result = e.target?.result;
      if (!result) {
        reject(new FileParsingError('Datei konnte nicht gelesen werden'));
        return;
      }
      
      onProgress?.({
        loaded: file.size,
        total: file.size,
        percentage: 100,
        stage: 'complete'
      });
      
      resolve({
        sanitizedName,
        content: result
      });
    };
    
    reader.onerror = () => {
      reject(new FileParsingError('Fehler beim Lesen der Datei'));
    };
    
    if (isCSV) {
      reader.readAsText(file, 'utf-8');
    } else {
      reader.readAsArrayBuffer(file);
    }
  });
};