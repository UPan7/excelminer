-- Update default role from 'viewer' to 'user'
ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'user';

-- Update existing users with 'viewer' role to 'user'
UPDATE public.profiles SET role = 'user' WHERE role = 'viewer';

-- Update the handle_new_user function to use 'user' instead of 'viewer'
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, role)
  VALUES (NEW.id, NEW.email, 'user');
  RETURN NEW;
END;
$$;