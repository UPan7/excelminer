import React from 'react';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, Upload, Eye, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { UploadProgress } from '@/utils/fileSecurityUtils';

interface ProgressTrackerProps {
  progress: UploadProgress;
  fileName: string;
  onCancel?: () => void;
  error?: string;
}

const ProgressTracker: React.FC<ProgressTrackerProps> = ({ 
  progress, 
  fileName, 
  onCancel,
  error 
}) => {
  const getStageIcon = (stage: UploadProgress['stage']) => {
    switch (stage) {
      case 'validating':
        return <Eye className="h-4 w-4" />;
      case 'reading':
        return <Upload className="h-4 w-4" />;
      case 'processing':
        return <Loader2 className="h-4 w-4 animate-spin" />;
      case 'complete':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      default:
        return <Loader2 className="h-4 w-4 animate-spin" />;
    }
  };

  const getStageText = (stage: UploadProgress['stage']) => {
    switch (stage) {
      case 'validating':
        return 'Validierung der Datei...';
      case 'reading':
        return 'Datei wird gelesen...';
      case 'processing':
        return 'Daten werden verarbeitet...';
      case 'complete':
        return 'Upload abgeschlossen';
      default:
        return 'Verarbeitung...';
    }
  };

  const getStageVariant = (stage: UploadProgress['stage']) => {
    switch (stage) {
      case 'validating':
        return 'secondary';
      case 'reading':
        return 'outline';
      case 'processing':
        return 'default';
      case 'complete':
        return 'default';
      default:
        return 'secondary';
    }
  };

  if (error) {
    return (
      <Alert className="border-destructive">
        <AlertDescription>
          <div className="flex items-center gap-2">
            <span className="font-medium">{fileName}</span>
            <Badge variant="destructive">Fehler</Badge>
          </div>
          <div className="mt-2 text-sm text-muted-foreground">{error}</div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Card className="w-full">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getStageIcon(progress.stage)}
            <span className="truncate max-w-xs">{fileName}</span>
            <Badge variant={getStageVariant(progress.stage)}>
              {progress.stage === 'complete' ? 'Fertig' : `${progress.percentage}%`}
            </Badge>
          </div>
          {onCancel && progress.stage !== 'complete' && (
            <button
              onClick={onCancel}
              className="text-muted-foreground hover:text-foreground text-sm"
            >
              Abbrechen
            </button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress 
          value={progress.percentage} 
          className="w-full h-2" 
        />
        <div className="flex justify-between items-center text-sm text-muted-foreground">
          <span>{getStageText(progress.stage)}</span>
          <span>
            {(progress.loaded / (1024 * 1024)).toFixed(1)}MB / {(progress.total / (1024 * 1024)).toFixed(1)}MB
          </span>
        </div>
      </CardContent>
    </Card>
  );
};

export default ProgressTracker;