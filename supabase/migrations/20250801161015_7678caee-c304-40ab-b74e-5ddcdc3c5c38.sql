-- Fix the security warning by setting search_path for the cleanup function
CREATE OR REPLACE FUNCTION public.cleanup_old_audit_logs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  DELETE FROM public.audit_logs 
  WHERE created_at < now() - INTERVAL '1 year';
END;
$$;