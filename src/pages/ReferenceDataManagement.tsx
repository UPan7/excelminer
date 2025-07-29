import React, { useState, useEffect } from 'react';
import { Upload, Database, Calendar, FileText, Trash2, Eye, CheckCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
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

const ReferenceDataManagement = () => {
  const [referenceLists, setReferenceLists] = useState<ReferenceList[]>([]);
  const [stats, setStats] = useState<ReferenceStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [isUploading, setIsUploading] = useState<Record<string, boolean>>({});
  const { toast } = useToast();

  useEffect(() => {
    loadReferenceData();
  }, []);

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

      setReferenceLists((lists || []) as ReferenceList[]);
      setStats((statsData || []) as ReferenceStats[]);
    } catch (error) {
      console.error('Error loading reference data:', error);
      toast({
        title: "Ошибка загрузки",
        description: "Не удалось загрузить данные эталонных списков",
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
        throw new Error('Файл должен содержать заголовки и данные');
      }

      const headers = data[0];
      const rows = data.slice(1);

      // Map headers to database columns
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

      // Find column indices
      const columnIndices: Record<string, number> = {};
      Object.keys(headerMapping).forEach(headerName => {
        const index = headers.findIndex(h => h && h.toString().toLowerCase().includes(headerName.toLowerCase()));
        if (index !== -1) {
          columnIndices[headerMapping[headerName as keyof typeof headerMapping]] = index;
        }
      });

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
              
              // Handle date fields
              if (field === 'dd_assessment_date' && value) {
                // Try to parse Excel date or string date
                const date = new Date(value);
                if (!isNaN(date.getTime())) {
                  facility[field] = date.toISOString().split('T')[0];
                }
              } else {
                facility[field] = value;
              }
            }
          });
          
          return facility;
        })
        .filter(facility => facility.smelter_id || facility.standard_smelter_name);

      setUploadProgress(prev => ({ ...prev, [listType]: 60 }));

      // Insert data in batches
      const batchSize = 1000;
      for (let i = 0; i < facilities.length; i += batchSize) {
        const batch = facilities.slice(i, i + batchSize);
        const { error: insertError } = await supabase
          .from('reference_facilities')
          .insert(batch);

        if (insertError) throw insertError;
        
        setUploadProgress(prev => ({ 
          ...prev, 
          [listType]: 60 + (i / facilities.length) * 30 
        }));
      }

      setUploadProgress(prev => ({ ...prev, [listType]: 90 }));

      // Update reference list metadata
      const { error: upsertError } = await supabase
        .from('reference_lists')
        .upsert({
          type: listType,
          version: new Date().toISOString().split('T')[0],
          record_count: facilities.length,
        });

      if (upsertError) throw upsertError;

      setUploadProgress(prev => ({ ...prev, [listType]: 100 }));

      toast({
        title: "Успешно загружено",
        description: `Загружено ${facilities.length} записей для ${listType}`,
      });

      // Reload data
      await loadReferenceData();
      
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: "Ошибка загрузки",
        description: error instanceof Error ? error.message : "Не удалось загрузить файл",
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
        title: "Данные очищены",
        description: `Эталонные данные ${listType} удалены`,
      });

      await loadReferenceData();
    } catch (error) {
      toast({
        title: "Ошибка",
        description: "Не удалось очистить данные",
        variant: "destructive",
      });
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('ru-RU');
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
                {type} Reference List
              </CardTitle>
              <CardDescription>
                Эталонные данные для {type === 'CMRT' ? 'Conflict Minerals' : type === 'EMRT' ? 'Extended Minerals' : 'All Minerals'}
              </CardDescription>
            </div>
            {list && (
              <Badge variant={sectionStats ? "default" : "secondary"}>
                {list.record_count.toLocaleString()} записей
              </Badge>
            )}
          </div>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {uploading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Загрузка...</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <Progress value={progress} />
            </div>
          )}

          {list ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                Обновлено: {formatDate(list.upload_date)}
              </div>
              
              {sectionStats && sectionStats.metal_counts && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Металлы:</p>
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
                  Обновить
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
                <span className="text-sm">Данные не загружены</span>
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
                Загрузить {type} файл
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-center h-64">
            <div className="text-center space-y-2">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
              <p className="text-muted-foreground">Загрузка данных...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold text-foreground">
            Управление эталонными данными
          </h1>
          <p className="text-muted-foreground">
            Загрузка и управление эталонными списками RMI для CMRT, EMRT и AMRT
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {renderReferenceSection('CMRT')}
          {renderReferenceSection('EMRT')}
          {renderReferenceSection('AMRT')}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Общая статистика</CardTitle>
            <CardDescription>
              Сводная информация по всем эталонным спискам
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
                    {stat.last_updated ? `Обновлено: ${formatDate(stat.last_updated)}` : 'Не загружено'}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ReferenceDataManagement;