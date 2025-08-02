import { useState, useEffect, createContext, useContext } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { auditLogger } from "@/utils/auditLogger";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
  userRole: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    // Set up auth state listener
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        
        // Fetch user role when user signs in and log audit event
        if (session?.user) {
          setTimeout(async () => {
            try {
              const { data: profile } = await supabase
                .from('profiles')
                .select('role')
                .eq('user_id', session.user.id)
                .maybeSingle();
              
              setUserRole(profile?.role || 'viewer');
              
              // Log successful login
              if (event === 'SIGNED_IN') {
                await auditLogger.logUserLogin(session.user.id, {
                  email: session.user.email,
                  role: profile?.role || 'viewer'
                });
              }
            } catch (error) {
              console.error('Error fetching user role:', error);
              setUserRole('viewer');
            }
          }, 0);
        } else {
          setUserRole(null);
          
          // Log logout if this was a sign out event
          if (event === 'SIGNED_OUT' && user) {
            setTimeout(async () => {
              await auditLogger.logUserLogout(user.id);
            }, 0);
          }
        }
        
        setLoading(false);
      }
    );

    // Check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        // Fetch user role for existing session
        setTimeout(async () => {
          try {
            const { data: profile } = await supabase
              .from('profiles')
              .select('role')
              .eq('user_id', session.user.id)
              .maybeSingle();
            
            setUserRole(profile?.role || 'viewer');
          } catch (error) {
            console.error('Error fetching user role:', error);
            setUserRole('viewer');
          }
          setLoading(false);
        }, 0);
      } else {
        setLoading(false);
      }
    });

    // Set up session timeout (8 hours)
    const sessionTimeout = 8 * 60 * 60 * 1000; // 8 hours in milliseconds
    let timeoutId: NodeJS.Timeout;

    const resetTimeout = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        signOut();
      }, sessionTimeout);
    };

    // Start timeout if user is authenticated
    if (session?.user) {
      resetTimeout();
    }

    // Reset timeout on user activity
    const activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    const resetTimeoutOnActivity = () => {
      if (session?.user) resetTimeout();
    };

    activityEvents.forEach(event => {
      document.addEventListener(event, resetTimeoutOnActivity, true);
    });

    return () => {
      subscription.unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
      activityEvents.forEach(event => {
        document.removeEventListener(event, resetTimeoutOnActivity, true);
      });
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setUserRole(null);
  };

  const value = {
    user,
    session,
    loading,
    signOut,
    userRole,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}