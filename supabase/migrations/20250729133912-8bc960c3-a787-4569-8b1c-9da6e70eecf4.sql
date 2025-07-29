-- Fix the get_reference_stats function - remove nested aggregates
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
  WITH facility_counts AS (
    SELECT 
      rf.list_type,
      COUNT(*) as total_facilities,
      rf.metal,
      COUNT(*) as metal_count
    FROM public.reference_facilities rf
    WHERE (list_type_param IS NULL OR rf.list_type = list_type_param)
      AND rf.metal IS NOT NULL
    GROUP BY rf.list_type, rf.metal
  ),
  aggregated_data AS (
    SELECT 
      fc.list_type,
      SUM(fc.total_facilities) as total_facilities,
      jsonb_object_agg(fc.metal, fc.metal_count) as metal_counts
    FROM facility_counts fc
    GROUP BY fc.list_type
  )
  SELECT 
    ad.list_type,
    ad.total_facilities,
    ad.metal_counts,
    rl.updated_at as last_updated
  FROM aggregated_data ad
  LEFT JOIN public.reference_lists rl ON ad.list_type = rl.type;
END;
$$;