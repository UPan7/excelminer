import React, { useState, useEffect } from 'react';
import { Upload, Database, Calendar, FileText, Trash2, Eye, CheckCircle, AlertTriangle, Shield, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import Navigation from '@/components/Navigation';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';
import * as XLSX from 'xlsx';

interface ReferenceList {
  id: string;
  type: 'CMRT' | 'EMRT' | 'AMRT';
  version: string;
  upload_date: string;
  record_count: number;
  created_at?: string;
  updated_at?: string;
  uploaded_by?: string;
}

interface ReferenceStats {
  list_type: string;
  total_facilities: number;
  metal_counts: any;
  last_updated: string;
}

interface OrganizationTemplate {
  id: string;
  template_name: string;
  cmrt_version?: string;
  company_name?: string;
  uploaded_at: string;
  is_active: boolean;
}

const ReferenceDataManagement = () => {
  const { user, loading: authLoading, signOut, userRole } = useAuth();
  const [referenceLists, setReferenceLists] = useState<ReferenceList[]>([]);
  const [stats, setStats] = useState<ReferenceStats[]>([]);
  const [organizationTemplate, setOrganizationTemplate] = useState<OrganizationTemplate | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [isUploading, setIsUploading] = useState<Record<string, boolean>>({});
  const [isTemplateUploading, setIsTemplateUploading] = useState(false);
  const { toast } = useToast();

  // All hooks must be called before any conditional returns
  useEffect(() => {
    if (user) {
      loadReferenceData();
    }
  }, [user]);

  // Redirect to auth if not authenticated
  if (!authLoading && !user) {
    return <Navigate to="/auth" replace />;
  }

  // Show loading while auth state is being determined
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-2">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="text-muted-foreground">Autorisierung prüfen...</p>
        </div>
      </div>
    );
  }

  const loadReferenceData = async () => {
    try {
      setIsLoading(true);
      
      // Load reference lists metadata
      const { data: lists, error: listsError } = await supabase
        .from('reference_lists')
        .select('*')
        .order('type');

      if (listsError) throw listsError;

      // Load statistics
      const { data: statsData, error: statsError } = await supabase
        .rpc('get_reference_stats');

      if (statsError) throw statsError;

      // Load organization template
      const { data: templateData, error: templateError } = await supabase
        .from('organization_templates')
        .select('*')
        .eq('is_active', true)
        .order('uploaded_at', { ascending: false })
        .limit(1)
        .single();

      if (templateError && templateError.code !== 'PGRST116') {
        console.warn('Error loading template:', templateError);
      }

      setReferenceLists((lists || []) as ReferenceList[]);
      setStats((statsData || []) as ReferenceStats[]);
      setOrganizationTemplate(templateData as OrganizationTemplate || null);
    } catch (error) {
      console.error('Error loading reference data:', error);
      toast({
        title: "Ladefehler",
        description: "Referenzdaten konnten nicht geladen werden",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (file: File, listType: 'CMRT' | 'EMRT' | 'AMRT') => {
    try {
      setIsUploading(prev => ({ ...prev, [listType]: true }));
      setUploadProgress(prev => ({ ...prev, [listType]: 0 }));

      // Parse the file
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as string[][];

      if (data.length < 2) {
        throw new Error('Datei muss Kopfzeilen und Daten enthalten');
      }

      const headers = data[0];
      const rows = data.slice(1);
      
      console.log('CSV Headers found:', headers);
      console.log('Total rows to process:', rows.length);

      // Map headers to database columns with more flexible matching
      const headerMapping = {
        'Facility ID': 'smelter_id',
        'Metal': 'metal',
        'Standard Facility Name': 'standard_smelter_name',
        'Country Location': 'country_location',
        'State/ Province/ Region': 'state_province_region',
        'Assessment Status': 'assessment_status',
        'Operational Status': 'operational_status',
        'Supply Chain Level': 'supply_chain_level',
        'RMI Cross Recognition': 'rmi_cross_recognition',
        'DD Assessment Scheme': 'dd_assessment_scheme',
        'DD Assessment Date': 'dd_assessment_date',
        'DD Assessment Cycle': 'dd_assessment_cycle',
        'Re-Assessment In Progress': 'reassessment_in_progress'
      };

      // Find column indices with more flexible matching
      const columnIndices: Record<string, number> = {};
      Object.keys(headerMapping).forEach(headerName => {
        // Try exact match first
        let index = headers.findIndex(h => h && h.toString().trim() === headerName);
        
        // If no exact match, try partial match
        if (index === -1) {
          index = headers.findIndex(h => h && h.toString().toLowerCase().includes(headerName.toLowerCase()));
        }
        
        // Try some alternative header names
        if (index === -1) {
          const alternatives: Record<string, string[]> = {
            'Facility ID': ['smelter id', 'facility_id', 'id'],
            'Standard Facility Name': ['facility name', 'smelter name', 'name'],
            'Country Location': ['country', 'location'],
            'State/ Province/ Region': ['state', 'province', 'region']
          };
          
          if (alternatives[headerName]) {
            for (const alt of alternatives[headerName]) {
              index = headers.findIndex(h => h && h.toString().toLowerCase().includes(alt));
              if (index !== -1) break;
            }
          }
        }
        
        if (index !== -1) {
          columnIndices[headerMapping[headerName as keyof typeof headerMapping]] = index;
          console.log(`Mapped header "${headerName}" to column ${index}: "${headers[index]}"`);
        } else {
          console.warn(`Header "${headerName}" not found in CSV`);
        }
      });
      
      console.log('Column indices mapping:', columnIndices);

      setUploadProgress(prev => ({ ...prev, [listType]: 20 }));

      // Clear existing data for this list type
      const { error: deleteError } = await supabase
        .from('reference_facilities')
        .delete()
        .eq('list_type', listType);

      if (deleteError) throw deleteError;

      setUploadProgress(prev => ({ ...prev, [listType]: 40 }));

      // Prepare data for insertion
      const facilities = rows
        .filter(row => row && row.length > 0 && row.some(cell => cell))
        .map(row => {
          const facility: any = { list_type: listType };
          
          Object.entries(columnIndices).forEach(([field, index]) => {
            if (index < row.length && row[index]) {
              let value = row[index].toString().trim();
              
              // Handle date fields with proper validation
              if (field === 'dd_assessment_date' && value) {
                // Try to parse Excel date or string date
                try {
                  // If it's a number (Excel date), convert it
                  if (!isNaN(Number(value))) {
                    // Excel date conversion (days since 1900-01-01)
                    const excelDate = Number(value);
                    if (excelDate > 0 && excelDate < 100000) { // Reasonable date range
                      const date = new Date((excelDate - 25569) * 86400 * 1000);
                      if (!isNaN(date.getTime()) && date.getFullYear() > 1900 && date.getFullYear() < 2100) {
                        facility[field] = date.toISOString().split('T')[0];
                      }
                    }
                  } else {
                    // Try to parse as regular date string
                    const date = new Date(value);
                    if (!isNaN(date.getTime()) && date.getFullYear() > 1900 && date.getFullYear() < 2100) {
                      facility[field] = date.toISOString().split('T')[0];
                    }
                  }
                } catch (error) {
                  // Skip invalid dates
                  console.warn('Invalid date value:', value);
                }
              } else {
                facility[field] = value;
              }
            }
          });
          
          return facility;
        });
        
      console.log('Raw facilities before filtering:', facilities.length);
      console.log('Sample facility object:', facilities[0]);
      
      const filteredFacilities = facilities.filter(facility => facility.smelter_id || facility.standard_smelter_name);
      
      console.log('Filtered facilities:', filteredFacilities.length);
      console.log('Sample filtered facility:', filteredFacilities[0]);
      
      if (filteredFacilities.length === 0) {
        console.error('No valid facilities found. Check header mapping and data format.');
        throw new Error('Keine gültigen Datensätze in der Datei gefunden. Bitte prüfen Sie das Datenformat und die Kopfzeilen.');
      }

      setUploadProgress(prev => ({ ...prev, [listType]: 60 }));

      // Insert data in batches
      const batchSize = 1000;
      for (let i = 0; i < filteredFacilities.length; i += batchSize) {
        const batch = filteredFacilities.slice(i, i + batchSize);
        const { error: insertError } = await supabase
          .from('reference_facilities')
          .insert(batch);

        if (insertError) throw insertError;
        
        setUploadProgress(prev => ({ 
          ...prev, 
          [listType]: 60 + (i / filteredFacilities.length) * 30 
        }));
      }

      setUploadProgress(prev => ({ ...prev, [listType]: 90 }));

      // Delete existing reference list metadata first
      await supabase
        .from('reference_lists')
        .delete()
        .eq('type', listType);

      // Insert new reference list metadata
      const { error: insertError } = await supabase
        .from('reference_lists')
        .insert({
          type: listType,
          version: new Date().toISOString().split('T')[0],
          record_count: filteredFacilities.length,
        });

      if (insertError) throw insertError;

      setUploadProgress(prev => ({ ...prev, [listType]: 100 }));

      toast({
        title: "Erfolgreich hochgeladen",
        description: `${filteredFacilities.length} Datensätze für ${listType} hochgeladen`,
      });

      // Reload data
      await loadReferenceData();
      
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: "Upload-Fehler",
        description: error instanceof Error ? error.message : "Datei konnte nicht hochgeladen werden",
        variant: "destructive",
      });
    } finally {
      setIsUploading(prev => ({ ...prev, [listType]: false }));
      setUploadProgress(prev => ({ ...prev, [listType]: 0 }));
    }
  };

  const clearReferenceData = async (listType: 'CMRT' | 'EMRT' | 'AMRT') => {
    try {
      const { error: deleteError } = await supabase
        .from('reference_facilities')
        .delete()
        .eq('list_type', listType);

      if (deleteError) throw deleteError;

      const { error: metaDeleteError } = await supabase
        .from('reference_lists')
        .delete()
        .eq('type', listType);

      if (metaDeleteError) throw metaDeleteError;

      toast({
        title: "Daten gelöscht",
        description: `Referenzdaten ${listType} entfernt`,
      });

      await loadReferenceData();
    } catch (error) {
      toast({
        title: "Fehler",
        description: "Daten konnten nicht gelöscht werden",
        variant: "destructive",
      });
    }
  };

  const handleTemplateUpload = async (file: File) => {
    try {
      setIsTemplateUploading(true);

      // Parse the file to extract basic info
      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      
      let companyName = '';
      let cmrtVersion = '';
      
      // Try to extract company name from Declaration sheet
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
                companyName = companyNameRow[col].trim();
                break;
              }
            }
          }
          
          // Try to find CMRT version (look for version patterns)
          const headerRows = declarationData.slice(0, 10);
          for (const row of headerRows) {
            if (Array.isArray(row)) {
              for (const cell of row) {
                if (cell && typeof cell === 'string' && cell.toLowerCase().includes('cmrt')) {
                  const versionMatch = cell.match(/\d+\.\d+/);
                  if (versionMatch) {
                    cmrtVersion = versionMatch[0];
                    break;
                  }
                }
              }
            }
            if (cmrtVersion) break;
          }
        } catch (declarationError) {
          console.warn('Could not extract info from Declaration sheet:', declarationError);
        }
      }

      // Store the entire workbook structure
      const fileData = {
        sheets: {},
        sheetNames: workbook.SheetNames
      };

      // Store all sheets
      workbook.SheetNames.forEach(sheetName => {
        fileData.sheets[sheetName] = workbook.Sheets[sheetName];
      });

      // Deactivate any existing templates
      await supabase
        .from('organization_templates')
        .update({ is_active: false })
        .eq('is_active', true);

      // Insert new template
      const { error: insertError } = await supabase
        .from('organization_templates')
        .insert({
          template_name: file.name,
          cmrt_version: cmrtVersion || null,
          company_name: companyName || null,
          file_data: fileData,
          uploaded_by: user?.id
        });

      if (insertError) throw insertError;

      toast({
        title: "Vorlage erfolgreich hochgeladen",
        description: `${file.name} wurde als Organisationsvorlage gespeichert`,
      });

      // Reload data
      await loadReferenceData();
      
    } catch (error) {
      console.error('Template upload error:', error);
      toast({
        title: "Upload-Fehler",
        description: error instanceof Error ? error.message : "Vorlage konnte nicht hochgeladen werden",
        variant: "destructive",
      });
    } finally {
      setIsTemplateUploading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('de-DE');
  };

  const getStatsForType = (type: string) => {
    return stats.find(s => s.list_type === type);
  };

  const renderReferenceSection = (type: 'CMRT' | 'EMRT' | 'AMRT') => {
    const list = referenceLists.find(l => l.type === type);
    const sectionStats = getStatsForType(type);
    const uploading = isUploading[type];
    const progress = uploadProgress[type] || 0;

    return (
      <Card key={type} className="h-full">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Database className="h-5 w-5" />
                {type}
              </CardTitle>
              <CardDescription>
                Referenzdaten für {type === 'CMRT' ? 'Konfliktminerale' : type === 'EMRT' ? 'Erweiterte Minerale' : 'Alle Minerale'}
              </CardDescription>
            </div>
            {list && (
              <Badge variant={sectionStats ? "default" : "secondary"}>
                {list.record_count.toLocaleString()} Datensätze
              </Badge>
            )}
          </div>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {uploading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Hochladen...</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} />
            </div>
          )}

          {list ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                Aktualisiert: {formatDate(list.upload_date)}
              </div>
              
              {sectionStats && sectionStats.metal_counts && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Metalle:</p>
                  <div className="flex flex-wrap gap-1">
                    {sectionStats.metal_counts && typeof sectionStats.metal_counts === 'object' && 
                     Object.entries(sectionStats.metal_counts).map(([metal, count]) => (
                      <Badge key={metal} variant="outline" className="text-xs">
                        {metal}: {String(count)}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = '.xlsx,.xls,.xml,.csv';
                    input.onchange = (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0];
                      if (file) handleFileUpload(file, type);
                    };
                    input.click();
                  }}
                  disabled={uploading}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Aktualisieren
                </Button>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => clearReferenceData(type)}
                  disabled={uploading}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-muted-foreground">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-sm">Daten nicht geladen</span>
              </div>
              
              <Button
                variant="default"
                className="w-full"
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = '.xlsx,.xls,.xml,.csv';
                  input.onchange = (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (file) handleFileUpload(file, type);
                  };
                  input.click();
                }}
                disabled={uploading}
              >
                <Upload className="h-4 w-4 mr-2" />
                {type} Datei hochladen
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  if (isLoading) {
    return (
      <>
        <Navigation />
        <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20 p-6">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center justify-center h-64">
              <div className="text-center space-y-2">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                <p className="text-muted-foreground">Daten laden...</p>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navigation />
      <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20 p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="text-center space-y-2">
            <h1 className="text-4xl font-bold text-foreground">
              Referenzdaten-Verwaltung
            </h1>
            <p className="text-muted-foreground">
              Upload und Verwaltung von RMI-Referenzlisten für CMRT, EMRT und AMRT
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {renderReferenceSection('CMRT')}
            {renderReferenceSection('EMRT')}
            {renderReferenceSection('AMRT')}
          </div>

          {/* Organization Template Section */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Unternehmensvorlage
                  </CardTitle>
                  <CardDescription>
                    CMRT-Vorlage der Organisation für konsolidierten Export
                  </CardDescription>
                </div>
                {organizationTemplate && (
                  <Badge variant="default">
                    Template aktiv
                  </Badge>
                )}
              </div>
            </CardHeader>
            
            <CardContent className="space-y-4">
              {isTemplateUploading && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span>Vorlage wird hochgeladen...</span>
                  </div>
                  <Progress value={50} />
                </div>
              )}

              {organizationTemplate ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    Template loaded: {organizationTemplate.template_name}
                  </div>
                  
                  {organizationTemplate.company_name && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">Unternehmen:</span>
                      <span>{organizationTemplate.company_name}</span>
                    </div>
                  )}
                  
                  {organizationTemplate.cmrt_version && (
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">CMRT Version:</span>
                      <span>{organizationTemplate.cmrt_version}</span>
                    </div>
                  )}
                  
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="h-4 w-4" />
                    Hochgeladen: {formatDate(organizationTemplate.uploaded_at)}
                  </div>
                  
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.accept = '.xlsx,.xls';
                        input.onchange = (e) => {
                          const file = (e.target as HTMLInputElement).files?.[0];
                          if (file) handleTemplateUpload(file);
                        };
                        input.click();
                      }}
                      disabled={isTemplateUploading}
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Vorlage aktualisieren
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm">Keine Vorlage hochgeladen</span>
                  </div>
                  
                  <Button
                    variant="default"
                    className="w-full"
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = '.xlsx,.xls';
                      input.onchange = (e) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (file) handleTemplateUpload(file);
                      };
                      input.click();
                    }}
                    disabled={isTemplateUploading}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Upload PSM-CMRT Template
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Gesamtstatistik</CardTitle>
              <CardDescription>
                Zusammenfassende Informationen zu allen Referenzlisten
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {stats.map(stat => (
                  <div key={stat.list_type} className="text-center space-y-2">
                    <h3 className="font-semibold">{stat.list_type}</h3>
                    <p className="text-2xl font-bold text-primary">
                      {stat.total_facilities.toLocaleString()}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {stat.last_updated ? `Aktualisiert: ${formatDate(stat.last_updated)}` : 'Nicht geladen'}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
};

export default ReferenceDataManagement;