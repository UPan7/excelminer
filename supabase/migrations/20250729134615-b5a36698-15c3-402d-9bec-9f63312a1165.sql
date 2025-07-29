-- CRITICAL SECURITY FIX: Implement proper RLS and authentication-based policies

-- First, ensure RLS is enabled on both tables
ALTER TABLE public.reference_facilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_lists ENABLE ROW LEVEL SECURITY;

-- Drop the dangerously permissive policies 
DROP POLICY IF EXISTS "Public can manage reference lists" ON public.reference_lists;
DROP POLICY IF EXISTS "Public can manage reference facilities" ON public.reference_facilities;
DROP POLICY IF EXISTS "Public can view reference lists" ON public.reference_lists;
DROP POLICY IF EXISTS "Public can view reference facilities" ON public.reference_facilities;

-- Create secure policies for reference_lists
-- Allow public read access for compliance checking
CREATE POLICY "Anyone can view reference lists" 
ON public.reference_lists 
FOR SELECT 
USING (true);

-- Require authentication for write operations
CREATE POLICY "Authenticated users can insert reference lists" 
ON public.reference_lists 
FOR INSERT 
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update reference lists" 
ON public.reference_lists 
FOR UPDATE 
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated users can delete reference lists" 
ON public.reference_lists 
FOR DELETE 
TO authenticated
USING (true);

-- Create secure policies for reference_facilities  
-- Allow public read access for compliance checking
CREATE POLICY "Anyone can view reference facilities" 
ON public.reference_facilities 
FOR SELECT 
USING (true);

-- Require authentication for write operations
CREATE POLICY "Authenticated users can insert reference facilities" 
ON public.reference_facilities 
FOR INSERT 
TO authenticated
WITH CHECK (true);

CREATE POLICY "Authenticated users can update reference facilities" 
ON public.reference_facilities 
FOR UPDATE 
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Authenticated users can delete reference facilities" 
ON public.reference_facilities 
FOR DELETE 
TO authenticated
USING (true);

-- Create profiles table for user management
CREATE TABLE public.profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  role text NOT NULL DEFAULT 'viewer',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create policies for profiles
CREATE POLICY "Users can view their own profile" 
ON public.profiles 
FOR SELECT 
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile" 
ON public.profiles 
FOR UPDATE 
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Create function to check user role
CREATE OR REPLACE FUNCTION public.get_user_role(user_uuid uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT role FROM public.profiles WHERE user_id = user_uuid;
$$;

-- Add trigger for updated_at
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, role)
  VALUES (NEW.id, NEW.email, 'viewer');
  RETURN NEW;
END;
$$;

-- Create trigger for new user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();