-- Fix security issues: set search_path for functions

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