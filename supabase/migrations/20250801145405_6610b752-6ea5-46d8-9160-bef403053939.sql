-- Fix the get_all_users function return type issue
CREATE OR REPLACE FUNCTION public.get_all_users()
RETURNS TABLE(
  user_id uuid,
  email text,
  role text,
  last_login timestamp with time zone,
  is_active boolean,
  failed_login_attempts integer,
  locked_until timestamp with time zone,
  created_at timestamp with time zone
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT 
    p.user_id, p.email, p.role::text, p.last_login, p.is_active, 
    p.failed_login_attempts, p.locked_until, p.created_at
  FROM public.profiles p
  WHERE EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE user_id = auth.uid() AND role = 'admin'
  )
  ORDER BY p.created_at DESC;
$$;