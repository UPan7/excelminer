import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  AlertTriangle, 
  XCircle, 
  AlertCircle, 
  Info, 
  RefreshCw, 
  Bug,
  Wifi,
  Database,
  FileX,
  Shield
} from 'lucide-react';
import { 
  ExcelMinerError, 
  FileParsingError, 
  ValidationError, 
  DatabaseError, 
  NetworkError, 
  AuthenticationError,
  ComparisonError,
  isExcelMinerError,
  isFileParsingError,
  isValidationError,
  isDatabaseError,
  isNetworkError,
  isAuthenticationError,
  isComparisonError
} from '@/types/errors';

interface ErrorDisplayProps {
  error: Error | ExcelMinerError;
  onRetry?: () => void;
  onDismiss?: () => void;
  variant?: 'alert' | 'card' | 'inline';
  showDetails?: boolean;
  className?: string;
}

const getErrorIcon = (error: Error) => {
  if (isFileParsingError(error)) return FileX;
  if (isValidationError(error)) return AlertCircle;
  if (isDatabaseError(error)) return Database;
  if (isNetworkError(error)) return Wifi;
  if (isAuthenticationError(error)) return Shield;
  if (isComparisonError(error)) return Bug;
  return XCircle;
};

const getErrorSeverity = (error: Error): 'error' | 'warning' | 'info' => {
  if (isValidationError(error)) return 'warning';
  if (isNetworkError(error)) return 'warning';
  return 'error';
};

const getErrorColor = (error: Error) => {
  const severity = getErrorSeverity(error);
  switch (severity) {
    case 'error': return 'destructive';
    case 'warning': return 'default';
    case 'info': return 'secondary';
    default: return 'destructive';
  }
};

const getErrorTitle = (error: Error): string => {
  if (isFileParsingError(error)) return 'Datei-Verarbeitungsfehler';
  if (isValidationError(error)) return 'Eingabevalidierungsfehler';
  if (isDatabaseError(error)) return 'Datenbankfehler';
  if (isNetworkError(error)) return 'Netzwerkfehler';
  if (isAuthenticationError(error)) return 'Authentifizierungsfehler';
  if (isComparisonError(error)) return 'Vergleichsfehler';
  return 'Unbekannter Fehler';
};

const getErrorDescription = (error: Error): string => {
  if (isFileParsingError(error)) {
    return 'Die hochgeladene Datei konnte nicht verarbeitet werden. Überprüfen Sie das Dateiformat und den Inhalt.';
  }
  if (isValidationError(error)) {
    return 'Die eingegebenen Daten entsprechen nicht den erwarteten Anforderungen.';
  }
  if (isDatabaseError(error)) {
    return 'Ein Problem beim Zugriff auf die Datenbank ist aufgetreten. Versuchen Sie es später erneut.';
  }
  if (isNetworkError(error)) {
    return 'Verbindungsprobleme sind aufgetreten. Überprüfen Sie Ihre Internetverbindung.';
  }
  if (isAuthenticationError(error)) {
    return 'Probleme bei der Anmeldung. Überprüfen Sie Ihre Anmeldedaten.';
  }
  if (isComparisonError(error)) {
    return 'Ein Fehler beim Vergleichsprozess ist aufgetreten. Überprüfen Sie die Eingabedaten.';
  }
  return 'Ein unerwarteter Fehler ist aufgetreten.';
};

const getSuggestions = (error: Error): string[] => {
  if (isFileParsingError(error)) {
    return [
      'Überprüfen Sie, ob die Datei im richtigen Format vorliegt (Excel oder CSV)',
      'Stellen Sie sicher, dass die Datei nicht beschädigt ist',
      'Überprüfen Sie die Spaltenüberschriften in der Datei'
    ];
  }
  if (isValidationError(error)) {
    return [
      'Überprüfen Sie alle Pflichtfelder',
      'Stellen Sie sicher, dass die Daten im richtigen Format vorliegen',
      'Kontrollieren Sie die Eingabebeschränkungen'
    ];
  }
  if (isDatabaseError(error)) {
    return [
      'Versuchen Sie es in wenigen Minuten erneut',
      'Überprüfen Sie Ihre Internetverbindung',
      'Kontaktieren Sie den Support, falls das Problem weiterhin besteht'
    ];
  }
  if (isNetworkError(error)) {
    return [
      'Überprüfen Sie Ihre Internetverbindung',
      'Versuchen Sie, die Seite neu zu laden',
      'Deaktivieren Sie temporär VPN oder Proxy-Verbindungen'
    ];
  }
  if (isAuthenticationError(error)) {
    return [
      'Überprüfen Sie Ihre E-Mail-Adresse und Ihr Passwort',
      'Vergewissern Sie sich, dass Ihr Konto aktiviert ist',
      'Setzen Sie Ihr Passwort zurück, falls notwendig'
    ];
  }
  return ['Versuchen Sie es erneut oder kontaktieren Sie den Support'];
};

export const ErrorDisplay: React.FC<ErrorDisplayProps> = ({
  error,
  onRetry,
  onDismiss,
  variant = 'alert',
  showDetails = false,
  className = ''
}) => {
  const IconComponent = getErrorIcon(error);
  const title = getErrorTitle(error);
  const description = getErrorDescription(error);
  const suggestions = getSuggestions(error);
  const isCustomError = isExcelMinerError(error);

  if (variant === 'alert') {
    return (
      <Alert variant={getErrorColor(error)} className={className}>
        <IconComponent className="h-4 w-4" />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>{error.message}</p>
          {showDetails && suggestions.length > 0 && (
            <div>
              <p className="font-medium text-sm mt-2 mb-1">Lösungsvorschläge:</p>
              <ul className="list-disc list-inside text-sm space-y-1">
                {suggestions.map((suggestion, index) => (
                  <li key={index}>{suggestion}</li>
                ))}
              </ul>
            </div>
          )}
          {onRetry && (
            <Button size="sm" onClick={onRetry} className="mt-2">
              <RefreshCw className="h-3 w-3 mr-1" />
              Erneut versuchen
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  if (variant === 'card') {
    return (
      <Card className={className}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IconComponent className="h-5 w-5 text-destructive" />
              <CardTitle className="text-destructive">{title}</CardTitle>
            </div>
            {isCustomError && (
              <Badge variant="outline">{(error as ExcelMinerError).code}</Badge>
            )}
          </div>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
            <p className="text-sm font-medium text-destructive">{error.message}</p>
          </div>

          {showDetails && suggestions.length > 0 && (
            <div>
              <h4 className="font-medium text-sm mb-2">Lösungsvorschläge:</h4>
              <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
                {suggestions.map((suggestion, index) => (
                  <li key={index}>{suggestion}</li>
                ))}
              </ul>
            </div>
          )}

          {isCustomError && (error as ExcelMinerError).details && showDetails && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Technische Details anzeigen
              </summary>
              <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto">
                {JSON.stringify((error as ExcelMinerError).details, null, 2)}
              </pre>
            </details>
          )}

          <div className="flex gap-2">
            {onRetry && (
              <Button onClick={onRetry}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Erneut versuchen
              </Button>
            )}
            {onDismiss && (
              <Button variant="outline" onClick={onDismiss}>
                Schließen
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Inline variant
  return (
    <div className={`flex items-center gap-2 text-sm text-destructive ${className}`}>
      <IconComponent className="h-4 w-4" />
      <span>{error.message}</span>
      {onRetry && (
        <Button size="sm" variant="ghost" onClick={onRetry}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
};

// Specialized error display components
export const FileErrorDisplay: React.FC<{ error: FileParsingError } & Omit<ErrorDisplayProps, 'error'>> = ({ error, ...props }) => (
  <ErrorDisplay error={error} {...props} />
);

export const ValidationErrorDisplay: React.FC<{ error: ValidationError } & Omit<ErrorDisplayProps, 'error'>> = ({ error, ...props }) => (
  <ErrorDisplay error={error} {...props} />
);

export const DatabaseErrorDisplay: React.FC<{ error: DatabaseError } & Omit<ErrorDisplayProps, 'error'>> = ({ error, ...props }) => (
  <ErrorDisplay error={error} {...props} />
);

export const NetworkErrorDisplay: React.FC<{ error: NetworkError } & Omit<ErrorDisplayProps, 'error'>> = ({ error, ...props }) => (
  <ErrorDisplay error={error} {...props} />
);