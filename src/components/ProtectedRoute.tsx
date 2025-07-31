import { ReactNode, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading, session } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // If not loading and no valid session, redirect to auth with original URL
    if (!loading && !session) {
      const returnUrl = location.pathname !== '/auth' ? location.pathname + location.search : '/';
      sessionStorage.setItem('returnUrl', returnUrl);
      navigate('/auth', { replace: true });
    }
  }, [loading, session, navigate, location]);

  // Show loading spinner while checking authentication
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Authentifizierung wird überprüft...</p>
        </div>
      </div>
    );
  }

  // If not authenticated, don't render children (will redirect)
  if (!session || !user) {
    return null;
  }

  // Authenticated - render the protected content
  return <>{children}</>;
}