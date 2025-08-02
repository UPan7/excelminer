import React, { useState, useEffect } from 'react';
import { CheckCircle, AlertTriangle, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';

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
  }>;
}

interface ComparisonOptionsProps {
  onSettingsChange: (settings: ComparisonSettings) => void;
  settings: ComparisonSettings;
}

const AVAILABLE_STANDARDS = ['CMRT', 'EMRT', 'AMRT'];
const AVAILABLE_METALS = ['Gold', 'Tin', 'Tantalum', 'Tungsten'];

const ComparisonOptions: React.FC<ComparisonOptionsProps> = ({ onSettingsChange, settings }) => {
  const [dbStatus, setDbStatus] = useState<DatabaseStatus>({
    isReady: false,
    totalRecords: 0,
    details: []
  });

  const loadDatabaseStatus = async () => {
    try {
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

      interface StatsData {
        total_facilities: number;
        list_type: string;
      }
      
      interface ListData {
        type: string;
        updated_at: string;
      }

      const totalRecords = (statsData || []).reduce((sum: number, stat: StatsData) => sum + (stat.total_facilities || 0), 0);
      const isReady = (lists || []).length > 0 && totalRecords > 0;
      const lastUpdated = (lists || []).reduce((latest: string | undefined, list: ListData) => {
        if (!latest || list.updated_at > latest) return list.updated_at;
        return latest;
      }, undefined);

      const details = AVAILABLE_STANDARDS.map(type => {
        const list = (lists || []).find((l: ListData) => l.type === type);
        const stat = (statsData || []).find((s: StatsData) => s.list_type === type);
        return {
          type,
          count: stat?.total_facilities || 0,
          lastUpdated: list?.updated_at
        };
      });

      setDbStatus({
        isReady,
        totalRecords,
        lastUpdated,
        details
      });
    } catch (error) {
      console.error('Error loading database status:', error);
    }
  };

  useEffect(() => {
    loadDatabaseStatus();
  }, []);


  const handleStandardChange = (standard: string, checked: boolean) => {
    const newStandards = checked 
      ? [...settings.standards, standard]
      : settings.standards.filter(s => s !== standard);
    
    onSettingsChange({
      ...settings,
      standards: newStandards
    });
  };

  const handleMetalChange = (metal: string, checked: boolean) => {
    const newMetals = checked
      ? [...settings.metals, metal]
      : settings.metals.filter(m => m !== metal);
    
    onSettingsChange({
      ...settings,
      metals: newMetals
    });
  };

  const selectAllMetals = () => {
    onSettingsChange({
      ...settings,
      metals: [...AVAILABLE_METALS]
    });
  };

  const deselectAllMetals = () => {
    onSettingsChange({
      ...settings,
      metals: []
    });
  };

  const formatDate = (dateString?: string) => {
    return dateString ? new Date(dateString).toLocaleDateString('de-DE') : 'Nicht hochgeladen';
  };

  return (
    <div className="space-y-6">
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
                Status der Referenzdatenbank
              </CardTitle>
              <CardDescription>
                {dbStatus.isReady 
                  ? `Die Basis ist einsatzbereit • ${dbStatus.totalRecords.toLocaleString()} Einträge`
                  : 'Referenzdaten müssen hochgeladen werden'
                }
              </CardDescription>
            </div>
            <Badge variant={dbStatus.isReady ? "default" : "secondary"}>
              {dbStatus.isReady ? "✓ Bereit" : "⚠️ Aktualisierung erforderlich"}
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
          
          {dbStatus.lastUpdated && (
            <div className="mt-4 pt-4 border-t text-sm text-muted-foreground">
              Letzte Aktualisierung: {formatDate(dbStatus.lastUpdated)}
            </div>
          )}
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
            Wählen Sie Standards und Metalle zur Konformitätsprüfung aus.
          </CardDescription>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Standards Selection */}
          <div className="space-y-3">
            <Label className="text-base font-medium">Standards zum Abgleich</Label>
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
                ⚠️ Wählen Sie mindestens einen Standard zum Abgleich aus.
              </p>
            )}
          </div>

          <Separator />

          {/* Metals Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base font-medium">Metalle zum Abgleich</Label>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={selectAllMetals}
                  disabled={settings.metals.length === AVAILABLE_METALS.length}
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
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {AVAILABLE_METALS.map(metal => (
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
            {settings.metals.length === 0 && (
              <p className="text-sm text-amber-600">
                ⚠️ Wählen Sie mindestens ein Metall zum Abgleich aus.
              </p>
            )}
          </div>

          {/* Settings Summary */}
          <div className="mt-6 p-4 bg-muted/50 rounded-lg">
            <h4 className="font-medium mb-2">Ausgewählte Parameter:</h4>
            <div className="space-y-2">
              <div>
                <span className="text-sm text-muted-foreground">Standards: </span>
                {settings.standards.length > 0 ? (
                  <span className="text-sm font-medium">{settings.standards.join(', ')}</span>
                ) : (
                  <span className="text-sm text-muted-foreground italic">nicht ausgewählt</span>
                )}
              </div>
              <div>
                <span className="text-sm text-muted-foreground">Metalle: </span>
                {settings.metals.length > 0 ? (
                  <span className="text-sm font-medium">{settings.metals.join(', ')}</span>
                ) : (
                  <span className="text-sm text-muted-foreground italic">nicht ausgewählt</span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ComparisonOptions;