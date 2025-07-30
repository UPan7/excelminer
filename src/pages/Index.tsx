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

interface SupplierFileData {
  id: string;
  name: string;
  status: 'pending' | 'processing' | 'complete' | 'error';
  size: number;
  data?: CMRTData[];
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

  const loadDatabaseStatus = async () => {
    try {
      const { data: statsData, error: statsError } = await supabase
        .rpc('get_reference_stats');

      if (statsError) throw statsError;

      // Get unique metals from database efficiently
      const { data: metalData, error: metalError } = await supabase
        .from('reference_facilities')
        .select('metal', { count: 'exact' })
        .not('metal', 'is', null)
        .order('metal');

      if (metalError) throw metalError;

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
    } catch (error) {
      console.error('Error loading database status:', error);
    }
  };

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

  const parseSupplierFile = async (file: File): Promise<CMRTData[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      const isCSV = file.name.toLowerCase().endsWith('.csv');
      
      reader.onload = (e) => {
        try {
          let jsonData: any[][];
          
          if (isCSV) {
            const text = e.target?.result as string;
            jsonData = parseCSVFile(text);
          } else {
            const data = new Uint8Array(e.target?.result as ArrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });
            let worksheet = workbook.Sheets['Smelter List'] || workbook.Sheets[workbook.SheetNames[0]];
            jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
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
            throw new Error('Could not find header row in supplier file');
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
                supplierData.push({
                  metal: metal.toString().trim(),
                  smelterName: smelterName.toString().trim(),
                  smelterCountry: (row[countryIndex] || '').toString().trim(),
                  smelterIdentificationNumber: (row[idIndex] || '').toString().trim(),
                });
              }
            }
          }
          
          resolve(supplierData);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      
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
      const supplierData = await parseSupplierFile(file);
      
      setSupplierFiles(prev => prev.map(f => 
        f.id === fileData.id 
          ? { ...f, status: 'complete', data: supplierData }
          : f
      ));

      toast({
        title: "Lieferantendatei erfolgreich verarbeitet",
        description: `${file.name} wurde geparst: ${supplierData.length} Schmelzereien gefunden.`,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unbekannter Fehler aufgetreten';
      
      setSupplierFiles(prev => prev.map(f => 
        f.id === fileData.id 
          ? { ...f, status: 'error', error: errorMessage }
          : f
      ));

      toast({
        variant: "destructive",
        title: "Verarbeitung fehlgeschlagen",
        description: errorMessage,
      });
    }
  };

  const handleFileUpload = useCallback((uploadedFiles: FileList) => {
    const newFiles: SupplierFileData[] = Array.from(uploadedFiles).map(file => ({
      id: `${Date.now()}-${Math.random()}`,
      name: file.name,
      status: 'pending',
      size: file.size,
    }));

    setSupplierFiles(prev => [...prev, ...newFiles]);

    Array.from(uploadedFiles).forEach((file, index) => {
      processSupplierFile(newFiles[index], file);
    });
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
    if (settings.standards.length === 0) {
      toast({
        variant: "destructive",
        title: "Keine Standards ausgewählt",
        description: "Bitte wählen Sie mindestens einen Standard für den Vergleich aus.",
      });
      return;
    }

    if (settings.metals.length === 0) {
      toast({
        variant: "destructive",
        title: "Keine Metalle ausgewählt",
        description: "Bitte wählen Sie mindestens ein Metall für die Prüfung aus.",
      });
      return;
    }

    const completeFiles = supplierFiles.filter(f => f.status === 'complete' && f.data);
    if (completeFiles.length === 0) {
      toast({
        variant: "destructive",
        title: "Keine Lieferantendateien",
        description: "Bitte laden Sie mindestens eine Lieferantendatei hoch.",
      });
      return;
    }

    setIsComparing(true);
    setComparisonResults([]);

    try {
      const { data: referenceData, error } = await supabase
        .from('reference_facilities')
        .select('*, list_type')
        .in('list_type', settings.standards)
        .in('metal', settings.metals)
        .not('standard_smelter_name', 'is', null);

      if (error) throw error;

      // Convert to RMI format for comparison engine with standard information
      const rmiData: RMIData[] = (referenceData || []).map(facility => ({
        facilityId: facility.smelter_id || '',
        standardFacilityName: facility.standard_smelter_name || '',
        metal: facility.metal || '',
        assessmentStatus: `${facility.list_type}: ${facility.assessment_status || 'Conformant'}`, // Include standard in status
      }));

      const engine = createComparisonEngine(rmiData, settings.standards, settings.metals);
      const allResults: ComparisonResult[] = [];
      
      for (const supplierFile of completeFiles) {
        if (supplierFile.data) {
          const filteredData = supplierFile.data.filter(item => 
            settings.metals.includes(item.metal)
          );

          const supplierName = supplierFile.name.replace(/\.(xlsx|xls|csv)$/i, '');
          const results = engine.compareSupplierData(supplierName, filteredData);
          allResults.push(...results);
        }
      }

      const summary = engine.getComparisonSummary(allResults);
      setComparisonResults(allResults);
      setComparisonSummary(summary);

      toast({
        title: "Vergleich abgeschlossen",
        description: `${allResults.length} Schmelzereien geprüft | Standards: ${settings.standards.join(', ')} | Metalle: ${settings.metals.join(', ')}`,
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unbekannter Fehler aufgetreten';
      toast({
        variant: "destructive",
        title: "Vergleich fehlgeschlagen",
        description: errorMessage,
      });
    } finally {
      setIsComparing(false);
    }
  };

  const clearAllFiles = () => {
    setSupplierFiles([]);
    setComparisonResults([]);
    setComparisonSummary(undefined);
    toast({
      title: "Dateien gelöscht",
      description: "Alle hochgeladenen Dateien wurden entfernt.",
    });
  };

  const removeFile = (fileId: string) => {
    setSupplierFiles(prev => prev.filter(f => f.id !== fileId));
    if (comparisonResults.length > 0) {
      setComparisonResults([]);
      setComparisonSummary(undefined);
    }
  };

  const handleStandardChange = (standard: string, checked: boolean) => {
    const newStandards = checked 
      ? [...settings.standards, standard]
      : settings.standards.filter(s => s !== standard);
    
    setSettings({
      ...settings,
      standards: newStandards
    });
  };

  const handleMetalChange = (metal: string, checked: boolean) => {
    const newMetals = checked
      ? [...settings.metals, metal]
      : settings.metals.filter(m => m !== metal);
    
    setSettings({
      ...settings,
      metals: newMetals
    });
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
              Professionelles Tool zum Vergleich von Lieferanten-Schmelzereien mit Referenzdaten.
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
                  Vergleichsparameter
                </CardTitle>
                <CardDescription>
                  Wählen Sie Standards und Metalle für die Prüfung aus
                </CardDescription>
              </CardHeader>
              
              <CardContent className="space-y-6">
                {/* Standards Selection */}
                <div className="space-y-3">
                  <Label className="text-base font-medium">Standards für Vergleich</Label>
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
                <CardTitle>Vergleich starten</CardTitle>
                <CardDescription>
                  Überprüfen Sie die Einstellungen und starten Sie den Vergleich
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
                        Vergleiche...
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
              <Card className="mb-4">
                <CardHeader>
                  <CardTitle>Vergleichsergebnis</CardTitle>
                  <CardDescription>
                    Geprüft: {comparisonResults.length} Schmelzereien | 
                    Standards: {settings.standards.join(', ')} | 
                    Metalle: {settings.metals.join(', ')}
                  </CardDescription>
                </CardHeader>
              </Card>
              <ComparisonResults results={comparisonResults} isProcessing={isComparing} summary={comparisonSummary} />
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default Index;