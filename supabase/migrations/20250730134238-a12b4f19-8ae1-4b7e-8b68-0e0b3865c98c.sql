-- Create table for organization templates
CREATE TABLE public.organization_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_name TEXT NOT NULL,
  cmrt_version TEXT,
  company_name TEXT,
  file_data JSONB NOT NULL,
  uploaded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true,
  uploaded_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.organization_templates ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Authenticated users can view organization templates" 
ON public.organization_templates 
FOR SELECT 
USING (true);

CREATE POLICY "Authenticated users can insert organization templates" 
ON public.organization_templates 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Authenticated users can update organization templates" 
ON public.organization_templates 
FOR UPDATE 
USING (true);

CREATE POLICY "Authenticated users can delete organization templates" 
ON public.organization_templates 
FOR DELETE 
USING (true);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_organization_templates_updated_at
BEFORE UPDATE ON public.organization_templates
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();