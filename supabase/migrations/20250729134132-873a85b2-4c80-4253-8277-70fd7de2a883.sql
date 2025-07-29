-- Fix RLS policies to allow unauthenticated access for reference data management
-- Since this is a reference data system, we'll allow public read/write access

-- Drop existing policies
DROP POLICY IF EXISTS "Everyone can view reference lists" ON public.reference_lists;
DROP POLICY IF EXISTS "Authenticated users can manage reference lists" ON public.reference_lists;
DROP POLICY IF EXISTS "Everyone can view reference facilities" ON public.reference_facilities;
DROP POLICY IF EXISTS "Authenticated users can manage reference facilities" ON public.reference_facilities;

-- Create new permissive policies for reference_lists
CREATE POLICY "Public can view reference lists" 
ON public.reference_lists 
FOR SELECT 
USING (true);

CREATE POLICY "Public can manage reference lists" 
ON public.reference_lists 
FOR ALL 
USING (true)
WITH CHECK (true);

-- Create new permissive policies for reference_facilities
CREATE POLICY "Public can view reference facilities" 
ON public.reference_facilities 
FOR SELECT 
USING (true);

CREATE POLICY "Public can manage reference facilities" 
ON public.reference_facilities 
FOR ALL 
USING (true)
WITH CHECK (true);