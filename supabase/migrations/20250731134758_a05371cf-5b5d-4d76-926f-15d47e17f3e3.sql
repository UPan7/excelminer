-- Add city column to reference_facilities table for CMRT export
ALTER TABLE public.reference_facilities 
ADD COLUMN city text;