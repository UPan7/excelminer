import { z } from 'zod';

// File validation schemas
export const fileValidationSchema = z.object({
  name: z.string().min(1, 'Dateiname ist erforderlich'),
  size: z.number().max(10 * 1024 * 1024, 'Datei darf nicht größer als 10MB sein'),
  type: z.string().refine(
    (type) => ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'].includes(type),
    'Nur Excel- und CSV-Dateien sind erlaubt'
  ),
});

// CMRT data validation schema
export const cmrtDataSchema = z.object({
  metal: z.string().min(1, 'Metall ist erforderlich'),
  smelterName: z.string().min(1, 'Schmelzerei-Name ist erforderlich'),
  smelterCountry: z.string().optional(),
  smelterIdentificationNumber: z.string().optional(),
});

export const cmrtDataArraySchema = z.array(cmrtDataSchema).min(1, 'Mindestens eine Schmelzerei ist erforderlich');

// RMI data validation schema
export const rmiDataSchema = z.object({
  facilityId: z.string(),
  standardFacilityName: z.string().min(1, 'Standard-Facilityname ist erforderlich'),
  metal: z.string().min(1, 'Metall ist erforderlich'),
  assessmentStatus: z.string().min(1, 'Bewertungsstatus ist erforderlich'),
  countryLocation: z.string().optional(),
  stateProvinceRegion: z.string().optional(),
  city: z.string().optional(),
  smelterReference: z.string().optional(),
});

export const rmiDataArraySchema = z.array(rmiDataSchema);

// Comparison settings validation schema
export const comparisonSettingsSchema = z.object({
  standards: z.array(z.string()).min(1, 'Mindestens ein Standard muss ausgewählt werden'),
  metals: z.array(z.string()).min(1, 'Mindestens ein Metall muss ausgewählt werden'),
});

// User authentication validation schema
export const authFormSchema = z.object({
  email: z.string().email('Gültige E-Mail-Adresse erforderlich'),
  password: z.string().min(8, 'Passwort muss mindestens 8 Zeichen lang sein'),
});

// Password setup validation schema for invited users
export const passwordSetupSchema = z.object({
  password: z.string().min(8, 'Passwort muss mindestens 8 Zeichen lang sein'),
  confirmPassword: z.string().min(8, 'Passwort-Bestätigung ist erforderlich'),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwörter stimmen nicht überein",
  path: ["confirmPassword"],
});

// API response validation schemas
export const supabaseErrorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  details: z.string().optional(),
  hint: z.string().optional(),
});

export const dbStatusSchema = z.object({
  isReady: z.boolean(),
  totalRecords: z.number(),
  lastUpdated: z.string().optional(),
  details: z.array(z.object({
    type: z.string(),
    count: z.number(),
    lastUpdated: z.string().optional(),
    metalCounts: z.record(z.number()).optional(),
  })),
});

// File upload validation
export const uploadedFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(['pending', 'processing', 'complete', 'error']),
  size: z.number(),
  data: cmrtDataArraySchema.optional(),
  supplierName: z.string().optional(),
  error: z.string().optional(),
});

// Comparison result validation schema
export const comparisonResultSchema = z.object({
  id: z.string(),
  supplierName: z.string(),
  smelterName: z.string(),
  metal: z.string(),
  country: z.string(),
  smelterIdentificationNumber: z.string(),
  matchStatus: z.enum(['conformant', 'active', 'non-conformant', 'attention-required']),
  rmiAssessmentStatus: z.string().optional(),
  confidenceScore: z.number().optional(),
  matchedFacilityName: z.string().optional(),
  matchedFacilityId: z.string().optional(),
  matchedStandards: z.array(z.string()).optional(),
  sourceStandard: z.string().optional(),
  countryLocation: z.string().optional(),
  stateProvinceRegion: z.string().optional(),
  city: z.string().optional(),
  smelterReference: z.string().optional(),
});

export const comparisonResultsArraySchema = z.array(comparisonResultSchema);

// Summary validation schema
export const comparisonSummarySchema = z.object({
  totalChecked: z.number(),
  standardsUsed: z.array(z.string()),
  metalsChecked: z.array(z.string()),
  conformant: z.number(),
  active: z.number(),
  nonConformant: z.number(),
  attentionRequired: z.number(),
  conformantPercentage: z.number(),
  byMetal: z.record(z.object({
    conformant: z.number(),
    total: z.number(),
    percentage: z.number(),
  })),
  byStandard: z.record(z.object({
    conformant: z.number(),
    total: z.number(),
    percentage: z.number(),
  })),
});

// Helper function to validate data with proper error handling
export const validateData = <T>(schema: z.ZodSchema<T>, data: unknown, context?: string): T => {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessage = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      throw new Error(`Validierungsfehler${context ? ` in ${context}` : ''}: ${errorMessage}`);
    }
    throw error;
  }
};