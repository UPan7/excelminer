import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Database, Home, CheckCircle, AlertTriangle, User, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface NavigationProps {
  referenceDataStatus?: {
    isReady: boolean;
    totalRecords: number;
    lastUpdated?: string;
  };
}

const Navigation: React.FC<NavigationProps> = ({ referenceDataStatus }) => {
  const location = useLocation();
  const { user, signOut } = useAuth();

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className="bg-card border-b shadow-sm">
      <div className="max-w-6xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1">
            <div className="mr-6">
              <h1 className="text-2xl font-bold text-primary">ExcelMiner</h1>
            </div>
            
            <Link to="/">
              <Button 
                variant={isActive('/') ? 'default' : 'ghost'}
                className={cn(
                  "flex items-center gap-2",
                  isActive('/') && "bg-primary text-primary-foreground"
                )}
              >
                <Home className="h-4 w-4" />
                Startseite
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
                Referenzdaten
              </Button>
            </Link>
          </div>

          <div className="flex items-center gap-4">
            {referenceDataStatus && (
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm">
                  {referenceDataStatus.isReady ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <span className="text-muted-foreground">Referenz-DB:</span>
                      <Badge variant="outline" className="text-green-700 border-green-200">
                        ✓ Bereit
                      </Badge>
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      <span className="text-muted-foreground">Referenz-DB:</span>
                      <Badge variant="outline" className="text-amber-700 border-amber-200">
                        ⚠️ Update erforderlich
                      </Badge>
                    </>
                  )}
                </div>
                
                {referenceDataStatus.isReady && (
                  <div className="text-sm text-muted-foreground">
                    {referenceDataStatus.totalRecords.toLocaleString()} Datensätze
                    {referenceDataStatus.lastUpdated && (
                      <span className="ml-2">
                        (aktualisiert: {new Date(referenceDataStatus.lastUpdated).toLocaleDateString('de-DE')})
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {user && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    {user.email}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={signOut} className="flex items-center gap-2">
                    <LogOut className="h-4 w-4" />
                    Abmelden
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navigation;