-- Create tables for reference data management

-- Table for tracking reference list versions and metadata
CREATE TABLE public.reference_lists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('CMRT', 'EMRT', 'AMRT')),
  version TEXT NOT NULL,
  upload_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  record_count INTEGER NOT NULL DEFAULT 0,
  uploaded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(type)
);

-- Table for storing all reference facility data
CREATE TABLE public.reference_facilities (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  list_type TEXT NOT NULL CHECK (list_type IN ('CMRT', 'EMRT', 'AMRT')),
  smelter_id TEXT,
  metal TEXT,
  standard_smelter_name TEXT,
  country_location TEXT,
  state_province_region TEXT,
  assessment_status TEXT,
  operational_status TEXT,
  supply_chain_level TEXT,
  rmi_cross_recognition TEXT,
  dd_assessment_scheme TEXT,
  dd_assessment_date DATE,
  dd_assessment_cycle TEXT,
  reassessment_in_progress TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.reference_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_facilities ENABLE ROW LEVEL SECURITY;

-- Create policies for reference_lists (read access for everyone, write for authenticated users)
CREATE POLICY "Everyone can view reference lists" 
ON public.reference_lists 
FOR SELECT 
USING (true);

CREATE POLICY "Authenticated users can manage reference lists" 
ON public.reference_lists 
FOR ALL 
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

-- Create policies for reference_facilities (read access for everyone, write for authenticated users)
CREATE POLICY "Everyone can view reference facilities" 
ON public.reference_facilities 
FOR SELECT 
USING (true);

CREATE POLICY "Authenticated users can manage reference facilities" 
ON public.reference_facilities 
FOR ALL 
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

-- Create indexes for better performance
CREATE INDEX idx_reference_facilities_list_type ON public.reference_facilities(list_type);
CREATE INDEX idx_reference_facilities_metal ON public.reference_facilities(metal);
CREATE INDEX idx_reference_facilities_smelter_id ON public.reference_facilities(smelter_id);
CREATE INDEX idx_reference_facilities_standard_name ON public.reference_facilities(standard_smelter_name);
CREATE INDEX idx_reference_facilities_list_type_metal ON public.reference_facilities(list_type, metal);

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_reference_lists_updated_at
  BEFORE UPDATE ON public.reference_lists
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_reference_facilities_updated_at
  BEFORE UPDATE ON public.reference_facilities
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to get reference data statistics
CREATE OR REPLACE FUNCTION public.get_reference_stats(list_type_param TEXT DEFAULT NULL)
RETURNS TABLE (
  list_type TEXT,
  total_facilities BIGINT,
  metal_counts JSONB,
  last_updated TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    rf.list_type,
    COUNT(*) as total_facilities,
    jsonb_object_agg(rf.metal, metal_count) as metal_counts,
    rl.updated_at as last_updated
  FROM public.reference_facilities rf
  LEFT JOIN public.reference_lists rl ON rf.list_type = rl.type
  WHERE (list_type_param IS NULL OR rf.list_type = list_type_param)
  GROUP BY rf.list_type, rl.updated_at;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;