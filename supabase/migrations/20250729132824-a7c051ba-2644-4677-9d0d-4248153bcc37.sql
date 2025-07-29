-- Fix security issues: recreate functions with proper search_path
-- First drop triggers, then function, then recreate all with correct settings

-- Drop triggers
DROP TRIGGER IF EXISTS update_reference_lists_updated_at ON public.reference_lists;
DROP TRIGGER IF EXISTS update_reference_facilities_updated_at ON public.reference_facilities;

-- Drop and recreate the update function with proper search_path
DROP FUNCTION IF EXISTS public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Recreate triggers
CREATE TRIGGER update_reference_lists_updated_at
  BEFORE UPDATE ON public.reference_lists
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_reference_facilities_updated_at
  BEFORE UPDATE ON public.reference_facilities
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Drop and recreate the stats function with proper search_path
DROP FUNCTION IF EXISTS public.get_reference_stats(TEXT);

CREATE OR REPLACE FUNCTION public.get_reference_stats(list_type_param TEXT DEFAULT NULL)
RETURNS TABLE (
  list_type TEXT,
  total_facilities BIGINT,
  metal_counts JSONB,
  last_updated TIMESTAMP WITH TIME ZONE
) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rf.list_type,
    COUNT(*) as total_facilities,
    jsonb_object_agg(rf.metal, COUNT(*)) as metal_counts,
    MAX(rl.updated_at) as last_updated
  FROM public.reference_facilities rf
  LEFT JOIN public.reference_lists rl ON rf.list_type = rl.type
  WHERE (list_type_param IS NULL OR rf.list_type = list_type_param)
  GROUP BY rf.list_type;
END;
$$;