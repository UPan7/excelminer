-- Add smelter_reference column to reference_facilities table
ALTER TABLE public.reference_facilities 
ADD COLUMN smelter_reference TEXT;