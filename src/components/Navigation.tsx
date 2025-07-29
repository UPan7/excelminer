import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Database, Home, CheckCircle, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface NavigationProps {
  referenceDataStatus?: {
    isReady: boolean;
    totalRecords: number;
    lastUpdated?: string;
  };
}

const Navigation: React.FC<NavigationProps> = ({ referenceDataStatus }) => {
  const location = useLocation();

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="bg-card border-b shadow-sm">
      <div className="max-w-6xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1">
            <Link to="/">
              <Button 
                variant={isActive('/') ? 'default' : 'ghost'}
                className={cn(
                  "flex items-center gap-2",
                  isActive('/') && "bg-primary text-primary-foreground"
                )}
              >
                <Home className="h-4 w-4" />
                Главная
              </Button>
            </Link>
            
            <Link to="/reference-data">
              <Button 
                variant={isActive('/reference-data') ? 'default' : 'ghost'}
                className={cn(
                  "flex items-center gap-2",
                  isActive('/reference-data') && "bg-primary text-primary-foreground"
                )}
              >
                <Database className="h-4 w-4" />
                Эталонные данные
              </Button>
            </Link>
          </div>

          {referenceDataStatus && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 text-sm">
                {referenceDataStatus.isReady ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-muted-foreground">Reference DB:</span>
                    <Badge variant="outline" className="text-green-700 border-green-200">
                      ✓ Ready
                    </Badge>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                    <span className="text-muted-foreground">Reference DB:</span>
                    <Badge variant="outline" className="text-amber-700 border-amber-200">
                      ⚠️ Update needed
                    </Badge>
                  </>
                )}
              </div>
              
              {referenceDataStatus.isReady && (
                <div className="text-sm text-muted-foreground">
                  {referenceDataStatus.totalRecords.toLocaleString()} записей
                  {referenceDataStatus.lastUpdated && (
                    <span className="ml-2">
                      (обновлено: {new Date(referenceDataStatus.lastUpdated).toLocaleDateString('ru-RU')})
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
};

export default Navigation;