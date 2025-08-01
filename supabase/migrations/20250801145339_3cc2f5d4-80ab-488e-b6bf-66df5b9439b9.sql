-- Create user roles enum for type safety  
CREATE TYPE public.user_role AS ENUM ('admin', 'user');

-- Update profiles table to use the enum (skip if role column already has the right type)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE public.user_role AS ENUM ('admin', 'user');
  END IF;
  
  -- Update existing role column to use enum if it's text
  BEGIN
    ALTER TABLE public.profiles ALTER COLUMN role TYPE user_role USING role::user_role;
  EXCEPTION
    WHEN OTHERS THEN
      -- If this fails, the column is already the right type
      NULL;
  END;
END $$;

-- Add missing columns to profiles table
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS last_login timestamp with time zone,
ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS failed_login_attempts integer NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS locked_until timestamp with time zone;

-- Create audit log table for enterprise tracking
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.profiles(user_id),
  action text NOT NULL,
  resource_type text,
  resource_id text,
  details jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on audit logs
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Admins can view all audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Users can view their own audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "System can insert audit logs" ON public.audit_logs;
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;

-- Create policies for audit logs
CREATE POLICY "Admins can view all audit logs" 
ON public.audit_logs 
FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

CREATE POLICY "Users can view their own audit logs" 
ON public.audit_logs 
FOR SELECT 
USING (user_id = auth.uid());

CREATE POLICY "System can insert audit logs" 
ON public.audit_logs 
FOR INSERT 
WITH CHECK (true);

-- Update profiles policies to allow admins to manage users
CREATE POLICY "Admins can view all profiles" 
ON public.profiles 
FOR SELECT 
USING (
  auth.uid() = user_id OR 
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

CREATE POLICY "Admins can update all profiles" 
ON public.profiles 
FOR UPDATE 
USING (
  auth.uid() = user_id OR 
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE user_id = auth.uid() AND role = 'admin'
  )
);

-- Allow profile creation for new users
CREATE POLICY "Users can insert their own profile" 
ON public.profiles 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Create function to check user roles securely
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT role::text FROM public.profiles WHERE user_id = auth.uid();
$$;

-- Create function to log audit events
CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_action text,
  p_resource_type text DEFAULT NULL,
  p_resource_id text DEFAULT NULL,
  p_details jsonb DEFAULT NULL,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.audit_logs (
    user_id, action, resource_type, resource_id, details, ip_address, user_agent
  ) VALUES (
    auth.uid(), p_action, p_resource_type, p_resource_id, p_details, 
    p_ip_address::inet, p_user_agent
  );
END;
$$;

-- Create function to handle failed login attempts
CREATE OR REPLACE FUNCTION public.handle_failed_login(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_max_attempts integer := 5;
  v_lockout_duration interval := '30 minutes';
BEGIN
  -- Get profile by email
  SELECT * INTO v_profile 
  FROM public.profiles 
  WHERE email = p_email;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'User not found');
  END IF;
  
  -- Check if already locked
  IF v_profile.locked_until IS NOT NULL AND v_profile.locked_until > now() THEN
    RETURN jsonb_build_object(
      'error', 'Account locked', 
      'locked_until', v_profile.locked_until
    );
  END IF;
  
  -- Increment failed attempts
  UPDATE public.profiles 
  SET 
    failed_login_attempts = failed_login_attempts + 1,
    locked_until = CASE 
      WHEN failed_login_attempts + 1 >= v_max_attempts 
      THEN now() + v_lockout_duration 
      ELSE NULL 
    END
  WHERE user_id = v_profile.user_id;
  
  -- Return status
  IF v_profile.failed_login_attempts + 1 >= v_max_attempts THEN
    RETURN jsonb_build_object(
      'error', 'Account locked due to too many failed attempts',
      'locked_until', now() + v_lockout_duration
    );
  ELSE
    RETURN jsonb_build_object(
      'attempts_remaining', v_max_attempts - (v_profile.failed_login_attempts + 1)
    );
  END IF;
END;
$$;

-- Create function to handle successful login
CREATE OR REPLACE FUNCTION public.handle_successful_login()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.profiles 
  SET 
    last_login = now(),
    failed_login_attempts = 0,
    locked_until = NULL
  WHERE user_id = auth.uid();
END;
$$;

-- Update the existing user creation trigger to set default role
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, role)
  VALUES (NEW.id, NEW.email, 'user');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create admin user management functions
CREATE OR REPLACE FUNCTION public.get_all_users()
RETURNS TABLE(
  user_id uuid,
  email text,
  role user_role,
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
    p.user_id, p.email, p.role, p.last_login, p.is_active, 
    p.failed_login_attempts, p.locked_until, p.created_at
  FROM public.profiles p
  WHERE EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE user_id = auth.uid() AND role = 'admin'
  )
  ORDER BY p.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.update_user_role(
  p_user_id uuid,
  p_role user_role
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Check if current user is admin
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE user_id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can update user roles';
  END IF;
  
  UPDATE public.profiles 
  SET role = p_role 
  WHERE user_id = p_user_id;
  
  -- Log the action
  PERFORM public.log_audit_event(
    'role_updated',
    'user',
    p_user_id::text,
    jsonb_build_object('new_role', p_role)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.toggle_user_status(
  p_user_id uuid,
  p_is_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Check if current user is admin
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE user_id = auth.uid() AND role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can update user status';
  END IF;
  
  UPDATE public.profiles 
  SET is_active = p_is_active 
  WHERE user_id = p_user_id;
  
  -- Log the action
  PERFORM public.log_audit_event(
    CASE WHEN p_is_active THEN 'user_activated' ELSE 'user_deactivated' END,
    'user',
    p_user_id::text,
    jsonb_build_object('is_active', p_is_active)
  );
END;
$$;