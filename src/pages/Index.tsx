import React, { useState, useCallback, useEffect } from 'react';
import { Upload, FileText, CheckCircle, XCircle, Loader2, AlertTriangle, Settings } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { ComparisonResults, type ComparisonResult, type ComparisonSummary } from '@/components/ComparisonResults';
import { ComparisonEngine, createComparisonEngine, type CMRTData, type RMIData } from '@/utils/comparisonEngine';
import Navigation from '@/components/Navigation';
import { supabase } from '@/integrations/supabase/client';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ErrorDisplay } from '@/components/ErrorDisplay';
import { 
  FileParsingError, 
  ValidationError, 
  DatabaseError, 
  ComparisonError,
  isExcelMinerError 
} from '@/types/errors';
import { 
  validateData, 
  fileValidationSchema, 
  cmrtDataArraySchema, 
  comparisonSettingsSchema,
  uploadedFileSchema 
} from '@/schemas/validationSchemas';
import { 
  showErrorToast, 
  showSuccessToast, 
  convertSupabaseError, 
  validateFileType,
  withErrorHandling 
} from '@/utils/errorHandling';

interface SupplierFileData {
  id: string;
  name: string;
  status: 'pending' | 'processing' | 'complete' | 'error';
  size: number;
  data?: CMRTData[];
  supplierName?: string;
  error?: string;
}

interface ComparisonSettings {
  standards: string[];
  metals: string[];
}

interface DatabaseStatus {
  isReady: boolean;
  totalRecords: number;
  lastUpdated?: string;
  details: Array<{
    type: string;
    count: number;
    lastUpdated?: string;
    metalCounts?: { [metal: string]: number };
  }>;
}

const AVAILABLE_STANDARDS = ['CMRT', 'EMRT', 'AMRT'];

const Index = () => {
  const [supplierFiles, setSupplierFiles] = useState<SupplierFileData[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [comparisonResults, setComparisonResults] = useState<ComparisonResult[]>([]);
  const [isComparing, setIsComparing] = useState(false);
  const [settings, setSettings] = useState<ComparisonSettings>({
    standards: ['CMRT'],
    metals: []
  });
  const [dbStatus, setDbStatus] = useState<DatabaseStatus>({
    isReady: false,
    totalRecords: 0,
    details: []
  });
  const [availableMetals, setAvailableMetals] = useState<string[]>([]);
  const [comparisonSummary, setComparisonSummary] = useState<ComparisonSummary | undefined>(undefined);
  const { toast } = useToast();

  useEffect(() => {
    loadDatabaseStatus();
  }, []);

  const loadDatabaseStatus = withErrorHandling(async () => {
    const { data: statsData, error: statsError } = await supabase
      .rpc('get_reference_stats');

    if (statsError) throw convertSupabaseError(statsError);

    // Get unique metals from database efficiently
    const { data: metalData, error: metalError } = await supabase
      .from('reference_facilities')
      .select('metal', { count: 'exact' })
      .not('metal', 'is', null)
      .order('metal');

    if (metalError) throw convertSupabaseError(metalError);

    const uniqueMetals = [...new Set(metalData.map(item => item.metal).filter(Boolean))].sort();
    setAvailableMetals(uniqueMetals);

    const totalRecords = (statsData || []).reduce((sum: number, stat: any) => sum + (stat.total_facilities || 0), 0);
    const isReady = totalRecords > 0;

    const details = AVAILABLE_STANDARDS.map(type => {
      const stat = (statsData || []).find((s: any) => s.list_type === type);
      return {
        type,
        count: stat?.total_facilities || 0,
        lastUpdated: stat?.last_updated,
        metalCounts: (stat?.metal_counts || {}) as { [metal: string]: number }
      };
    });

    setDbStatus({
      isReady,
      totalRecords,
      details
    });

    showSuccessToast('Datenbank-Status aktualisiert', `${totalRecords} Datensätze verfügbar`);
  }, 'Database status loading');

  const parseCSVFile = (text: string): string[][] => {
    const lines = text.split('\n');
    const result: string[][] = [];
    
    for (const line of lines) {
      if (line.trim()) {
        const fields: string[] = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            fields.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        
        fields.push(current.trim());
        result.push(fields);
      }
    }
    
    return result;
  };

  const parseSupplierFile = async (file: File): Promise<{ supplierName: string; smelterData: CMRTData[] }> => {
    // Validate file first
    validateFileType(file);
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const isCSV = file.name.toLowerCase().endsWith('.csv');
      
      reader.onload = (e) => {
        try {
          let jsonData: any[][];
          let supplierName = file.name.replace(/\.(xlsx|xls|csv)$/i, '');
          
          if (isCSV) {
            const text = e.target?.result as string;
            if (!text || text.trim().length === 0) {
              throw new FileParsingError('CSV-Datei ist leer oder konnte nicht gelesen werden', { fileName: file.name });
            }
            jsonData = parseCSVFile(text);
          } else {
            const data = new Uint8Array(e.target?.result as ArrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });
            
            if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
              throw new FileParsingError('Excel-Datei enthält keine Arbeitsblätter', { fileName: file.name });
            }
            
            // Try to extract supplier name from Declaration sheet
            if (workbook.Sheets['Declaration']) {
              try {
                const declarationSheet = workbook.Sheets['Declaration'];
                const declarationData = XLSX.utils.sheet_to_json(declarationSheet, { header: 1 });
                
                // Look for company name in D8 (or merged range D8:G8)
                const companyNameRow = declarationData[7] as any[]; // Row 8 (0-indexed)
                if (companyNameRow) {
                  // Check cells D8, E8, F8, G8 (columns 3, 4, 5, 6)
                  for (let col = 3; col <= 6; col++) {
                    if (companyNameRow[col] && typeof companyNameRow[col] === 'string' && companyNameRow[col].trim()) {
                      supplierName = companyNameRow[col].trim();
                      break;
                    }
                  }
                }
              } catch (declarationError) {
                console.warn('Could not extract supplier name from Declaration sheet:', declarationError);
              }
            }
            
            let worksheet = workbook.Sheets['Smelter List'] || workbook.Sheets[workbook.SheetNames[0]];
            if (!worksheet) {
              throw new FileParsingError('Kein gültiges Arbeitsblatt gefunden', { fileName: file.name, availableSheets: workbook.SheetNames });
            }
            jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          }
          
          if (!jsonData || jsonData.length === 0) {
            throw new FileParsingError('Datei enthält keine Daten', { fileName: file.name });
          }
          
          let headerRowIndex = 3;
          
          if (headerRowIndex >= jsonData.length || 
              !jsonData[headerRowIndex] || 
              !(jsonData[headerRowIndex] as any[]).some((cell: any) => 
                typeof cell === 'string' && cell.toLowerCase().includes('metal')
              )) {
            headerRowIndex = jsonData.findIndex((row: any) => 
              row.some((cell: any) => 
                typeof cell === 'string' && 
                (cell.toLowerCase().includes('metal') || 
                 cell.toLowerCase().includes('smelter'))
              )
            );
          }
          
          if (headerRowIndex === -1) {
            throw new FileParsingError(
              'Konnte keine Kopfzeile mit Metall- oder Schmelzerei-Spalten finden. Überprüfen Sie das Dateiformat.', 
              { fileName: file.name, dataPreview: jsonData.slice(0, 10) }
            );
          }
          
          const headers = jsonData[headerRowIndex] as string[];
          const supplierData: CMRTData[] = [];
          
          for (let i = headerRowIndex + 1; i < jsonData.length; i++) {
            const row = jsonData[i] as any[];
            if (row.some(cell => cell !== null && cell !== undefined && cell !== '')) {
              const metalIndex = headers.findIndex(h => h && h.toLowerCase().includes('metal'));
              const smelterNameIndex = headers.findIndex(h => h && 
                (h.toLowerCase().includes('smelter look-up') ||
                 h.toLowerCase().includes('smelter name') ||
                 h.toLowerCase().includes('facility name') ||
                 h.toLowerCase().includes('refinery name'))
              );
              const countryIndex = headers.findIndex(h => h && h.toLowerCase().includes('country'));
              const idIndex = headers.findIndex(h => h && 
                (h.toLowerCase().includes('smelter identification') || 
                 h.toLowerCase().includes('identification') || 
                 h.toLowerCase().includes('facility id') ||
                 h.toLowerCase().includes('smelter id'))
              );
              
              const smelterName = row[smelterNameIndex] || '';
              const metal = row[metalIndex] || '';
              
              if (smelterName && smelterName.toString().trim()) {
                const cmrtData: CMRTData = {
                  metal: metal.toString().trim(),
                  smelterName: smelterName.toString().trim(),
                  smelterCountry: (row[countryIndex] || '').toString().trim(),
                  smelterIdentificationNumber: (row[idIndex] || '').toString().trim(),
                };
                
                // Validate individual CMRT data entry
                try {
                  validateData(cmrtDataArraySchema.element, cmrtData, `Row ${i + 1}`);
                  supplierData.push(cmrtData);
                } catch (validationError) {
                  console.warn(`Skipping invalid row ${i + 1}:`, validationError);
                }
              }
            }
          }
          
          if (supplierData.length === 0) {
            throw new FileParsingError(
              'Keine gültigen Schmelzerei-Daten gefunden. Überprüfen Sie die Spaltenüberschriften und Datenformat.', 
              { fileName: file.name, headers, expectedColumns: ['Metal', 'Smelter Name', 'Country'] }
            );
          }
          
              // Validate the complete dataset
              const validatedData = validateData(cmrtDataArraySchema, supplierData, 'Supplier data');
              
              resolve({ supplierName, smelterData: validatedData });
        } catch (error) {
          if (error instanceof FileParsingError || error instanceof ValidationError) {
            reject(error);
          } else {
            reject(new FileParsingError(
              `Unerwarteter Fehler beim Verarbeiten der Datei: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`,
              { fileName: file.name, originalError: error }
            ));
          }
        }
      };
      
      reader.onerror = () => reject(new FileParsingError('Fehler beim Lesen der Datei', { fileName: file.name }));
      
      if (isCSV) {
        reader.readAsText(file, 'utf-8');
      } else {
        reader.readAsArrayBuffer(file);
      }
    });
  };

  const processSupplierFile = async (fileData: SupplierFileData, file: File) => {
    setSupplierFiles(prev => prev.map(f => 
      f.id === fileData.id ? { ...f, status: 'processing' } : f
    ));

    try {
      const result = await parseSupplierFile(file);
      
      // Validate the processed file data
      const validatedFileData = validateData(uploadedFileSchema, {
        ...fileData,
        status: 'complete' as const,
        data: result.smelterData,
        supplierName: result.supplierName
      }, 'Processed file data');
      
      setSupplierFiles(prev => prev.map(f => 
        f.id === fileData.id 
          ? { ...f, status: 'complete', data: result.smelterData, supplierName: result.supplierName }
          : f
      ));

      showSuccessToast(
        "Lieferantendatei erfolgreich verarbeitet",
        `${file.name} wurde geparst: ${result.smelterData.length} Schmelzereien gefunden. Lieferant: ${result.supplierName}`
      );
    } catch (error) {
      if (isExcelMinerError(error)) {
        showErrorToast(error);
      } else {
        const fileError = new FileParsingError(
          error instanceof Error ? error.message : 'Unbekannter Fehler bei der Dateiverarbeitung',
          { fileName: file.name, originalError: error }
        );
        showErrorToast(fileError);
      }
      
      setSupplierFiles(prev => prev.map(f => 
        f.id === fileData.id 
          ? { ...f, status: 'error', error: error instanceof Error ? error.message : 'Unbekannter Fehler' }
          : f
      ));
    }
  };

  const handleFileUpload = useCallback((uploadedFiles: FileList) => {
    try {
      // Validate each file before processing
      const validFiles: File[] = [];
      const fileErrors: string[] = [];
      
      Array.from(uploadedFiles).forEach(file => {
        try {
          validateFileType(file);
          validFiles.push(file);
        } catch (error) {
          const fileName = file.name;
          const errorMsg = error instanceof Error ? error.message : 'Unbekannter Dateifehler';
          fileErrors.push(`${fileName}: ${errorMsg}`);
        }
      });
      
      if (fileErrors.length > 0) {
        showErrorToast(new ValidationError(
          'Einige Dateien konnten nicht verarbeitet werden',
          { fileErrors }
        ));
      }
      
      if (validFiles.length === 0) {
        return;
      }
      
      const newFiles: SupplierFileData[] = validFiles.map(file => ({
        id: `${Date.now()}-${Math.random()}`,
        name: file.name,
        status: 'pending',
        size: file.size,
      }));

      setSupplierFiles(prev => [...prev, ...newFiles]);

      validFiles.forEach((file, index) => {
        processSupplierFile(newFiles[index], file);
      });
    } catch (error) {
      showErrorToast(new ValidationError(
        'Fehler beim Hochladen der Dateien',
        { originalError: error }
      ));
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileUpload(files);
    }
  }, [handleFileUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileUpload(e.target.files);
    }
  }, [handleFileUpload]);

  const runComparison = async () => {
    try {
      // Validate comparison settings
      const validatedSettings = validateData(comparisonSettingsSchema, settings, 'Comparison settings');
      
      const completeFiles = supplierFiles.filter(f => f.status === 'complete' && f.data);
      if (completeFiles.length === 0) {
        throw new ValidationError('Keine verarbeiteten Lieferantendateien verfügbar', {
          totalFiles: supplierFiles.length,
          completeFiles: completeFiles.length
        });
      }

      setIsComparing(true);
      setComparisonResults([]);

      const { data: referenceData, error } = await supabase
        .from('reference_facilities')
        .select('*, list_type')
        .in('list_type', validatedSettings.standards)
        .in('metal', validatedSettings.metals)
        .not('standard_smelter_name', 'is', null);

      if (error) throw convertSupabaseError(error);

      if (!referenceData || referenceData.length === 0) {
        throw new DatabaseError('Keine Referenzdaten für die ausgewählten Standards und Metalle gefunden', {
          standards: validatedSettings.standards,
          metals: validatedSettings.metals
        });
      }

      // Convert to RMI format for comparison engine with standard information
      const rmiData: RMIData[] = referenceData.map(facility => ({
        facilityId: facility.smelter_id || '',
        standardFacilityName: facility.standard_smelter_name || '',
        metal: facility.metal || '',
        assessmentStatus: `${facility.list_type}: ${facility.assessment_status || 'Conformant'}`,
        countryLocation: facility.country_location || '',
        stateProvinceRegion: facility.state_province_region || '',
        city: facility.city || '',
        smelterReference: facility.smelter_reference || ''
      }));

      try {
        const engine = createComparisonEngine(rmiData, validatedSettings.standards, validatedSettings.metals);
        const allResults: ComparisonResult[] = [];
        
        for (const supplierFile of completeFiles) {
          if (supplierFile.data) {
            const filteredData = supplierFile.data.filter(item => 
              validatedSettings.metals.includes(item.metal)
            );

            if (filteredData.length === 0) {
              console.warn(`No matching metals found in file ${supplierFile.name}`);
              continue;
            }

            const supplierName = supplierFile.supplierName || supplierFile.name.replace(/\.(xlsx|xls|csv)$/i, '');
            const results = engine.compareSupplierData(supplierName, filteredData);
            allResults.push(...results);
          }
        }

        if (allResults.length === 0) {
          throw new ComparisonError('Keine Vergleichsergebnisse generiert', {
            fileCount: completeFiles.length,
            settings: validatedSettings
          });
        }

        const summary = engine.getComparisonSummary(allResults);
        setComparisonResults(allResults);
        setComparisonSummary(summary);

        showSuccessToast(
          "Abgleich erfolgreich abgeschlossen",
          `${allResults.length} Schmelzereien geprüft | Standards: ${validatedSettings.standards.join(', ')} | Metalle: ${validatedSettings.metals.join(', ')}`
        );
      } catch (error) {
        if (error instanceof ComparisonError) {
          throw error;
        } else {
          throw new ComparisonError(
            'Fehler beim Ausführen der Vergleichslogik',
            { originalError: error instanceof Error ? error.message : error }
          );
        }
      }
    } catch (error) {
      if (isExcelMinerError(error)) {
        showErrorToast(error);
      } else {
        showErrorToast(new ComparisonError(
          error instanceof Error ? error.message : 'Unbekannter Abgleichsfehler',
          { originalError: error }
        ));
      }
    } finally {
      setIsComparing(false);
    }
  };

  const clearAllFiles = () => {
    setSupplierFiles([]);
    setComparisonResults([]);
    setComparisonSummary(undefined);
    showSuccessToast("Dateien gelöscht", "Alle hochgeladenen Dateien wurden entfernt.");
  };

  const removeFile = (fileId: string) => {
    setSupplierFiles(prev => prev.filter(f => f.id !== fileId));
    if (comparisonResults.length > 0) {
      setComparisonResults([]);
      setComparisonSummary(undefined);
    }
  };

  const handleStandardChange = (standard: string, checked: boolean) => {
    try {
      const newStandards = checked 
        ? [...settings.standards, standard]
        : settings.standards.filter(s => s !== standard);
      
      const newSettings = {
        ...settings,
        standards: newStandards
      };
      
      // Validate settings before applying
      validateData(comparisonSettingsSchema.pick({ standards: true }), { standards: newStandards }, 'Standards selection');
      setSettings(newSettings);
    } catch (error) {
      showErrorToast(new ValidationError('Ungültige Auswahl der Standards', { selectedStandard: standard, currentStandards: settings.standards }));
    }
  };

  const handleMetalChange = (metal: string, checked: boolean) => {
    try {
      const newMetals = checked
        ? [...settings.metals, metal]
        : settings.metals.filter(m => m !== metal);
      
      const newSettings = {
        ...settings,
        metals: newMetals
      };
      
      // Don't validate empty metals during interaction, only during comparison
      setSettings(newSettings);
    } catch (error) {
      showErrorToast(new ValidationError('Ungültige Auswahl der Metalle', { selectedMetal: metal, currentMetals: settings.metals }));
    }
  };

  const selectAllMetals = () => {
    const filteredMetals = ['Gold', 'Tin', 'Cobalt', 'Copper', 'Nickel'].filter(metal => availableMetals.includes(metal));
    setSettings({
      ...settings,
      metals: [...filteredMetals]
    });
  };

  const deselectAllMetals = () => {
    setSettings({
      ...settings,
      metals: []
    });
  };

  const formatDate = (dateString?: string) => {
    return dateString ? new Date(dateString).toLocaleDateString('de-DE') : 'Nicht geladen';
  };

  const getStatusIcon = (status: SupplierFileData['status']) => {
    switch (status) {
      case 'pending':
        return <FileText className="h-4 w-4 text-muted-foreground" />;
      case 'processing':
        return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
      case 'complete':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'error':
        return <XCircle className="h-4 w-4 text-destructive" />;
    }
  };

  const getStatusBadge = (status: SupplierFileData['status']) => {
    switch (status) {
      case 'pending':
        return <Badge variant="secondary">Wartend</Badge>;
      case 'processing':
        return <Badge className="bg-primary">Verarbeitung</Badge>;
      case 'complete':
        return <Badge className="bg-green-600 hover:bg-green-700">Abgeschlossen</Badge>;
      case 'error':
        return <Badge variant="destructive">Fehler</Badge>;
    }
  };

  return (
    <>
      <Navigation />
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold mb-4">ExcelMiner</h1>
            <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
              Professionelles Tool zum Abgleich von Lieferanten-Schmelzereien mit Referenzdaten.
              Wählen Sie Standards und Metalle aus und laden Sie Ihre Lieferantendateien hoch.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            {/* Database Status */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      {dbStatus.isReady ? (
                        <CheckCircle className="h-5 w-5 text-green-500" />
                      ) : (
                        <AlertTriangle className="h-5 w-5 text-amber-500" />
                      )}
                      Referenzdatenbank Status
                    </CardTitle>
                    <CardDescription>
                      {dbStatus.isReady 
                        ? `Datenbank bereit • ${dbStatus.totalRecords.toLocaleString()} Einträge`
                        : 'Referenzdaten müssen geladen werden'
                      }
                    </CardDescription>
                  </div>
                  <Badge variant={dbStatus.isReady ? "default" : "secondary"}>
                    {dbStatus.isReady ? "✓ Bereit" : "⚠️ Update erforderlich"}
                  </Badge>
                </div>
              </CardHeader>
              
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {dbStatus.details.map(detail => (
                    <div key={detail.type} className="text-center space-y-1">
                      <p className="font-medium">{detail.type}</p>
                      <p className="text-2xl font-bold text-primary">
                        {detail.count.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(detail.lastUpdated)}
                      </p>
                    </div>
                  ))}
                </div>
                
              </CardContent>
            </Card>

            {/* Comparison Settings */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  Abgleichsparameter
                </CardTitle>
                <CardDescription>
                  Wählen Sie Standards und Metalle für die Prüfung aus
                </CardDescription>
              </CardHeader>
              
              <CardContent className="space-y-6">
                {/* Standards Selection */}
                <div className="space-y-3">
                  <Label className="text-base font-medium">Standards für Abgleich</Label>
                  <div className="grid grid-cols-3 gap-4">
                    {AVAILABLE_STANDARDS.map(standard => (
                      <div key={standard} className="flex items-center space-x-2">
                        <Checkbox
                          id={`standard-${standard}`}
                          checked={settings.standards.includes(standard)}
                          onCheckedChange={(checked) => handleStandardChange(standard, checked === true)}
                          disabled={!dbStatus.details.find(d => d.type === standard)?.count}
                        />
                        <Label 
                          htmlFor={`standard-${standard}`}
                          className="text-sm font-normal cursor-pointer"
                        >
                          {standard}
                          <span className="ml-1 text-xs text-muted-foreground">
                            ({dbStatus.details.find(d => d.type === standard)?.count || 0})
                          </span>
                        </Label>
                      </div>
                    ))}
                  </div>
                  {settings.standards.length === 0 && (
                    <p className="text-sm text-amber-600">
                      ⚠️ Wählen Sie mindestens einen Standard aus
                    </p>
                  )}
                </div>

                <Separator />

                {/* Metals Selection */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-base font-medium">Metalle für Prüfung</Label>
                    <div className="flex gap-2">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={selectAllMetals}
                        disabled={settings.metals.length === ['Gold', 'Tin', 'Cobalt', 'Copper', 'Nickel'].filter(metal => availableMetals.includes(metal)).length}
                      >
                        Alle auswählen
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={deselectAllMetals}
                        disabled={settings.metals.length === 0}
                      >
                        Alle abwählen
                      </Button>
                    </div>
                  </div>

                  {/* Group metals by standards */}
                  <div className="space-y-4">
                    {/* CMRT Standards */}
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-2">CMRT Standards</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {['Gold', 'Tin'].filter(metal => availableMetals.includes(metal)).map(metal => (
                          <div key={metal} className="flex items-center space-x-2">
                            <Checkbox
                              id={`metal-${metal}`}
                              checked={settings.metals.includes(metal)}
                              onCheckedChange={(checked) => handleMetalChange(metal, checked === true)}
                            />
                            <Label 
                              htmlFor={`metal-${metal}`}
                              className="text-sm font-normal cursor-pointer"
                            >
                              {metal}
                            </Label>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* EMRT Standards */}
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-2">EMRT Standards</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        {['Cobalt', 'Copper', 'Nickel'].filter(metal => availableMetals.includes(metal)).map(metal => (
                          <div key={metal} className="flex items-center space-x-2">
                            <Checkbox
                              id={`metal-${metal}`}
                              checked={settings.metals.includes(metal)}
                              onCheckedChange={(checked) => handleMetalChange(metal, checked === true)}
                            />
                            <Label 
                              htmlFor={`metal-${metal}`}
                              className="text-sm font-normal cursor-pointer"
                            >
                              {metal}
                            </Label>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  
                  {settings.metals.length === 0 && (
                    <p className="text-sm text-amber-600">
                      ⚠️ Wählen Sie mindestens ein Metall aus
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* File Upload and Control */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
            {/* File Upload */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Upload className="h-5 w-5" />
                  Lieferantendateien hochladen
                </CardTitle>
                <CardDescription>
                  Laden Sie Ihre CMRT/EMRT/AMRT Lieferantendateien hoch (Excel/CSV)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                    isDragOver
                      ? 'border-primary bg-primary/10'
                      : 'border-muted-foreground/25 hover:border-primary'
                  }`}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                >
                  <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="text-lg font-semibold mb-2">
                    Dateien hierher ziehen oder klicken zum Auswählen
                  </h3>
                  <p className="text-muted-foreground mb-4">
                    Unterstützte Formate: Excel (.xlsx, .xls), CSV (.csv)
                  </p>
                  <input
                    type="file"
                    multiple
                    accept=".xlsx,.xls,.csv"
                    onChange={handleFileInput}
                    className="hidden"
                    id="file-upload"
                  />
                  <Button asChild>
                    <label htmlFor="file-upload" className="cursor-pointer">
                      Dateien auswählen
                    </label>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Process Control */}
            <Card>
              <CardHeader>
                <CardTitle>Abgleich starten</CardTitle>
                <CardDescription>
                  Überprüfen Sie die Einstellungen und starten Sie den Abgleich
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Summary */}
                <div className="p-4 bg-muted/50 rounded-lg space-y-2">
                  <div className="text-sm">
                    <span className="font-medium">Standards: </span>
                    {settings.standards.length > 0 ? (
                      <span>{settings.standards.join(', ')}</span>
                    ) : (
                      <span className="text-muted-foreground italic">keine ausgewählt</span>
                    )}
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Metalle: </span>
                    {settings.metals.length > 0 ? (
                      <span>{settings.metals.join(', ')}</span>
                    ) : (
                      <span className="text-muted-foreground italic">keine ausgewählt</span>
                    )}
                  </div>
                  <div className="text-sm">
                    <span className="font-medium">Dateien: </span>
                    {supplierFiles.filter(f => f.status === 'complete').length} bereit
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col gap-3">
                  <Button 
                    onClick={runComparison} 
                    disabled={
                      settings.standards.length === 0 || 
                      settings.metals.length === 0 || 
                      supplierFiles.filter(f => f.status === 'complete').length === 0 || 
                      isComparing
                    }
                    className="w-full"
                  >
                    {isComparing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Gleiche ab...
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        Dateien abgleichen
                      </>
                    )}
                  </Button>
                  
                  <Button 
                    variant="outline" 
                    onClick={clearAllFiles}
                    disabled={supplierFiles.length === 0}
                  >
                    Alle Dateien löschen
                  </Button>
                </div>
                
                {/* Validation messages */}
                {(settings.standards.length === 0 || settings.metals.length === 0) && (
                  <div className="text-sm text-amber-600 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    Bitte wählen Sie mindestens einen Standard und ein Metall aus
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Uploaded Files List */}
          {supplierFiles.length > 0 && (
            <Card className="mb-8">
              <CardHeader>
                <CardTitle>Hochgeladene Lieferantendateien</CardTitle>
                <CardDescription>
                  Verwalten Sie Ihre hochgeladenen Dateien
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {supplierFiles.map((file) => (
                    <div 
                      key={file.id} 
                      className="flex items-center justify-between p-4 border rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        {getStatusIcon(file.status)}
                        <div>
                          <p className="font-medium">{file.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {(file.size / 1024 / 1024).toFixed(2)} MB
                            {file.data && ` • ${file.data.length} Schmelzereien gefunden`}
                            {file.supplierName && file.supplierName !== file.name.replace(/\.(xlsx|xls|csv)$/i, '') && (
                              <span className="block">Lieferant: {file.supplierName}</span>
                            )}
                          </p>
                          {file.error && (
                            <p className="text-sm text-destructive mt-1">{file.error}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {getStatusBadge(file.status)}
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => removeFile(file.id)}
                        >
                          Entfernen
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Results */}
          {comparisonResults.length > 0 && (
            <div className="mb-8">
              <ComparisonResults results={comparisonResults} isProcessing={isComparing} summary={comparisonSummary} />
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default Index;