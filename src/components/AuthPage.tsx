import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { User, Session } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Eye, EyeOff } from "lucide-react";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ErrorDisplay } from "@/components/ErrorDisplay";
import { AuthenticationError, isExcelMinerError } from "@/types/errors";
import { authFormSchema, passwordSetupSchema } from "@/schemas/validationSchemas";
import { showErrorToast, showSuccessToast, convertSupabaseError } from "@/utils/errorHandling";
import { auditLogger } from "@/utils/auditLogger";

interface AuthPageProps {
  onAuthSuccess?: (user: User, session: Session) => void;
}

type AuthFormData = {
  email: string;
  password: string;
};

type PasswordSetupData = {
  password: string;
  confirmPassword: string;
};

export default function AuthPage({ onAuthSuccess }: AuthPageProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [authError, setAuthError] = useState<Error | null>(null);
  const [isInviteMode, setIsInviteMode] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  const form = useForm<AuthFormData>({
    resolver: zodResolver(authFormSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const passwordForm = useForm<PasswordSetupData>({
    resolver: zodResolver(passwordSetupSchema),
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
  });

  useEffect(() => {
    // Check for invitation parameters in URL
    const urlParams = new URLSearchParams(window.location.search);
    const tokenHash = urlParams.get('token_hash');
    const type = urlParams.get('type');
    
    if (tokenHash && type === 'invite') {
      setIsInviteMode(true);
      setInviteToken(tokenHash);
      // Clear URL params after extraction
      window.history.replaceState({}, document.title, window.location.pathname);
      return; // Don't check session if we're in invite mode
    }

    const checkSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw convertSupabaseError(error);
        
        if (session?.user) {
          handleAuthSuccess(session.user, session);
        }
      } catch (error) {
        if (isExcelMinerError(error)) {
          setAuthError(error);
        } else {
          setAuthError(new AuthenticationError('Fehler beim Überprüfen der Sitzung'));
        }
      }
    };

    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_IN' && session?.user) {
          handleAuthSuccess(session.user, session);
        }
        if (event === 'SIGNED_OUT') {
          setAuthError(null);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [onAuthSuccess]);

  const handleAuthSuccess = (user: User, session: Session) => {
    setAuthError(null);
    if (onAuthSuccess) {
      onAuthSuccess(user, session);
    } else {
      const returnUrl = sessionStorage.getItem('returnUrl') || '/';
      sessionStorage.removeItem('returnUrl');
      navigate(returnUrl, { replace: true });
    }
  };

  const handleSignIn = async (data: AuthFormData) => {
    setIsLoading(true);
    setAuthError(null);

    try {
      const { data: authData, error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          throw new AuthenticationError('Ungültige Anmeldedaten. Überprüfen Sie E-Mail und Passwort.');
        } else if (error.message.includes('Email not confirmed')) {
          throw new AuthenticationError('E-Mail-Adresse wurde noch nicht bestätigt. Überprüfen Sie Ihr E-Mail-Postfach.');
        } else if (error.message.includes('Too many requests')) {
          throw new AuthenticationError('Zu viele Anmeldeversuche. Versuchen Sie es später erneut.');
        } else {
          throw convertSupabaseError(error);
        }
      }

      if (authData.user && authData.session) {
        showSuccessToast("Willkommen zurück!", "Sie haben sich erfolgreich angemeldet.");
        handleAuthSuccess(authData.user, authData.session);
      }
    } catch (error) {
      // Log failed login attempt
      await auditLogger.logLoginFailure(data.email, error instanceof Error ? error.message : 'Unknown error');
      
      if (isExcelMinerError(error)) {
        setAuthError(error);
        showErrorToast(error);
      } else {
        const authError = new AuthenticationError(
          'Ein unerwarteter Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.'
        );
        setAuthError(authError);
        showErrorToast(authError);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordSetup = async (data: PasswordSetupData) => {
    if (!inviteToken) {
      setAuthError(new AuthenticationError('Einladungstoken fehlt'));
      return;
    }

    setIsLoading(true);
    setAuthError(null);

    try {
      const { data: authData, error } = await supabase.auth.verifyOtp({
        token_hash: inviteToken,
        type: 'invite',
      });

      if (error) {
        if (error.message.includes('Token has expired')) {
          throw new AuthenticationError('Einladungslink ist abgelaufen. Bitte um eine neue Einladung.');
        } else if (error.message.includes('Invalid token')) {
          throw new AuthenticationError('Ungültiger Einladungslink.');
        } else {
          throw convertSupabaseError(error);
        }
      }

      // Set the password for the user
      const { error: updateError } = await supabase.auth.updateUser({
        password: data.password
      });

      if (updateError) {
        throw convertSupabaseError(updateError);
      }

      if (authData.user && authData.session) {
        showSuccessToast("Passwort erfolgreich eingerichtet!", "Sie können sich jetzt anmelden.");
        handleAuthSuccess(authData.user, authData.session);
      }
    } catch (error) {
      if (isExcelMinerError(error)) {
        setAuthError(error);
        showErrorToast(error);
      } else {
        const authError = new AuthenticationError(
          'Ein Fehler beim Einrichten des Passworts ist aufgetreten. Bitte versuchen Sie es erneut.'
        );
        setAuthError(authError);
        showErrorToast(authError);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-muted/20 to-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <img 
                src="/lovable-uploads/6c3710d1-89e1-436a-b297-049f3819fdf5.png" 
                alt="Protech Logo" 
                className="h-12 w-auto"
              />
            </div>
            <CardTitle className="text-2xl font-bold">ExcelMiner</CardTitle>
            <CardDescription>
              {isInviteMode ? "Passwort für Ihr Konto einrichten" : "Anmelden für Zugriff auf die Anwendung"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {authError && (
              <ErrorDisplay 
                error={authError} 
                variant="alert" 
                onDismiss={() => setAuthError(null)}
              />
            )}
            
            {isInviteMode ? (
              <Form {...passwordForm}>
                <form onSubmit={passwordForm.handleSubmit(handlePasswordSetup)} className="space-y-4">
                  <FormField
                    control={passwordForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Neues Passwort</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              type={showPassword ? "text" : "password"}
                              placeholder="Passwort eingeben"
                              {...field}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                              onClick={() => setShowPassword(!showPassword)}
                            >
                              {showPassword ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={passwordForm.control}
                    name="confirmPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Passwort bestätigen</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              type={showConfirmPassword ? "text" : "password"}
                              placeholder="Passwort wiederholen"
                              {...field}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                            >
                              {showConfirmPassword ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? "Passwort einrichten..." : "Passwort einrichten"}
                  </Button>
                </form>
              </Form>
            ) : (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(handleSignIn)} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>E-Mail</FormLabel>
                        <FormControl>
                          <Input
                            type="email"
                            placeholder="E-Mail eingeben"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Passwort</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              type={showPassword ? "text" : "password"}
                              placeholder="Passwort eingeben"
                              {...field}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                              onClick={() => setShowPassword(!showPassword)}
                            >
                              {showPassword ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? "Anmelden..." : "Anmelden"}
                  </Button>
                </form>
              </Form>
            )}
          </CardContent>
        </Card>
      </div>
    </ErrorBoundary>
  );
}