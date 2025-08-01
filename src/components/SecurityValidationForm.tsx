import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { comparisonSettingsSchema } from '@/schemas/validationSchemas';
import { validateDatabaseInput } from '@/utils/databaseSecurity';
import { ValidationError } from '@/types/errors';
import { showErrorToast } from '@/utils/errorHandling';
import { Shield, AlertTriangle, CheckCircle } from 'lucide-react';

interface ComparisonSettings {
  standards: string[];
  metals: string[];
}

interface SecurityValidationFormProps {
  onSettingsChange: (settings: ComparisonSettings) => void;
  settings: ComparisonSettings;
  availableMetals: string[];
  dbStatus: {
    isReady: boolean;
    details: Array<{
      type: string;
      count: number;
    }>;
  };
}

const AVAILABLE_STANDARDS = ['CMRT', 'EMRT', 'AMRT'];

const SecurityValidationForm: React.FC<SecurityValidationFormProps> = ({
  onSettingsChange,
  settings,
  availableMetals,
  dbStatus
}) => {
  const [validationStatus, setValidationStatus] = useState<{
    isValid: boolean;
    errors: string[];
  }>({ isValid: true, errors: [] });

  const form = useForm<ComparisonSettings>({
    resolver: zodResolver(comparisonSettingsSchema),
    defaultValues: settings,
    mode: 'onChange' // Enable real-time validation
  });

  // Watch form changes for real-time validation
  const watchedValues = form.watch();

  React.useEffect(() => {
    validateSettings(watchedValues);
  }, [watchedValues]);

  const validateSettings = async (formSettings: ComparisonSettings) => {
    try {
      // Client-side validation
      const result = comparisonSettingsSchema.safeParse(formSettings);
      
      if (!result.success) {
        const errors = result.error.errors.map(err => err.message);
        setValidationStatus({ isValid: false, errors });
        return;
      }

      // Database input validation
      validateDatabaseInput.comparisonSettings(formSettings);

      // Security checks
      const securityErrors: string[] = [];
      
      // Check if standards have data available
      formSettings.standards.forEach(standard => {
        const detail = dbStatus.details.find(d => d.type === standard);
        if (!detail || detail.count === 0) {
          securityErrors.push(`Standard ${standard} hat keine verfügbaren Daten`);
        }
      });

      // Check metal availability
      formSettings.metals.forEach(metal => {
        if (!availableMetals.includes(metal)) {
          securityErrors.push(`Metall ${metal} ist nicht in der Datenbank verfügbar`);
        }
      });

      if (securityErrors.length > 0) {
        setValidationStatus({ isValid: false, errors: securityErrors });
        return;
      }

      setValidationStatus({ isValid: true, errors: [] });
      onSettingsChange(formSettings);
      
    } catch (error) {
      const errorMessage = error instanceof ValidationError 
        ? error.message 
        : 'Unbekannter Validierungsfehler';
      
      setValidationStatus({ isValid: false, errors: [errorMessage] });
      showErrorToast(error instanceof Error ? error : new ValidationError(errorMessage));
    }
  };

  const handleStandardChange = (standard: string, checked: boolean) => {
    const newStandards = checked 
      ? [...form.getValues('standards'), standard]
      : form.getValues('standards').filter(s => s !== standard);
    
    form.setValue('standards', newStandards, { shouldValidate: true });
  };

  const handleMetalChange = (metal: string, checked: boolean) => {
    const newMetals = checked
      ? [...form.getValues('metals'), metal]
      : form.getValues('metals').filter(m => m !== metal);
    
    form.setValue('metals', newMetals, { shouldValidate: true });
  };

  const selectAllMetals = () => {
    form.setValue('metals', [...availableMetals], { shouldValidate: true });
  };

  const deselectAllMetals = () => {
    form.setValue('metals', [], { shouldValidate: true });
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Sichere Abgleichsparameter
          {validationStatus.isValid ? (
            <Badge variant="default" className="ml-auto">
              <CheckCircle className="h-3 w-3 mr-1" />
              Validiert
            </Badge>
          ) : (
            <Badge variant="destructive" className="ml-auto">
              <AlertTriangle className="h-3 w-3 mr-1" />
              Fehler
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Validation Status */}
        {!validationStatus.isValid && validationStatus.errors.length > 0 && (
          <Alert className="border-destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-1">
                <p className="font-medium">Validierungsfehler:</p>
                {validationStatus.errors.map((error, index) => (
                  <p key={index} className="text-sm">• {error}</p>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        )}

        <Form {...form}>
          <form className="space-y-6">
            {/* Standards Selection */}
            <FormField
              control={form.control}
              name="standards"
              render={() => (
                <FormItem>
                  <FormLabel className="text-base font-medium">
                    Standards zum Abgleich
                  </FormLabel>
                  <FormControl>
                    <div className="grid grid-cols-3 gap-4">
                      {AVAILABLE_STANDARDS.map(standard => {
                        const detail = dbStatus.details.find(d => d.type === standard);
                        const isDisabled = !detail || detail.count === 0;
                        
                        return (
                          <div key={standard} className="flex items-center space-x-2">
                            <Checkbox
                              id={`standard-${standard}`}
                              checked={form.getValues('standards').includes(standard)}
                              onCheckedChange={(checked) => handleStandardChange(standard, checked === true)}
                              disabled={isDisabled}
                            />
                            <label 
                              htmlFor={`standard-${standard}`}
                              className={`text-sm cursor-pointer ${isDisabled ? 'text-muted-foreground' : ''}`}
                            >
                              {standard}
                              <span className="ml-1 text-xs text-muted-foreground">
                                ({detail?.count || 0})
                              </span>
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Metals Selection */}
            <FormField
              control={form.control}
              name="metals"
              render={() => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel className="text-base font-medium">
                      Metalle zum Abgleich
                    </FormLabel>
                    <div className="flex gap-2">
                      <Button 
                        type="button"
                        variant="outline" 
                        size="sm" 
                        onClick={selectAllMetals}
                        disabled={form.getValues('metals').length === availableMetals.length}
                      >
                        Alle auswählen
                      </Button>
                      <Button 
                        type="button"
                        variant="outline" 
                        size="sm" 
                        onClick={deselectAllMetals}
                        disabled={form.getValues('metals').length === 0}
                      >
                        Alle abwählen
                      </Button>
                    </div>
                  </div>
                  <FormControl>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      {availableMetals.map(metal => (
                        <div key={metal} className="flex items-center space-x-2">
                          <Checkbox
                            id={`metal-${metal}`}
                            checked={form.getValues('metals').includes(metal)}
                            onCheckedChange={(checked) => handleMetalChange(metal, checked === true)}
                          />
                          <label 
                            htmlFor={`metal-${metal}`}
                            className="text-sm cursor-pointer"
                          >
                            {metal}
                          </label>
                        </div>
                      ))}
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Settings Summary */}
            <div className="mt-6 p-4 bg-muted/50 rounded-lg">
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Validierte Parameter:
              </h4>
              <div className="space-y-2">
                <div>
                  <span className="text-sm text-muted-foreground">Standards: </span>
                  {form.getValues('standards').length > 0 ? (
                    <span className="text-sm font-medium">
                      {form.getValues('standards').join(', ')}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground italic">nicht ausgewählt</span>
                  )}
                </div>
                <div>
                  <span className="text-sm text-muted-foreground">Metalle: </span>
                  {form.getValues('metals').length > 0 ? (
                    <span className="text-sm font-medium">
                      {form.getValues('metals').join(', ')}
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground italic">nicht ausgewählt</span>
                  )}
                </div>
              </div>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
};

export default SecurityValidationForm;