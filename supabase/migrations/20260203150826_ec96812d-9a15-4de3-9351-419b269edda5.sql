-- Create role enum for owner vs family
CREATE TYPE public.app_role AS ENUM ('owner', 'family');

-- Create user_roles table
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL DEFAULT 'family',
    owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE (user_id)
);

-- Enable RLS
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Function to get owner_id for a user (returns self if owner, otherwise their linked owner)
CREATE OR REPLACE FUNCTION public.get_owner_id(_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE 
    WHEN role = 'owner' THEN user_id
    ELSE owner_id
  END
  FROM public.user_roles
  WHERE user_id = _user_id
$$;

-- RLS policies for user_roles
CREATE POLICY "Users can view own role"
ON public.user_roles
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Owners can view family roles"
ON public.user_roles
FOR SELECT
USING (public.has_role(auth.uid(), 'owner') AND owner_id = auth.uid());

CREATE POLICY "Owners can insert family members"
ON public.user_roles
FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'owner') AND owner_id = auth.uid());

CREATE POLICY "Owners can update family roles"
ON public.user_roles
FOR UPDATE
USING (public.has_role(auth.uid(), 'owner') AND owner_id = auth.uid());

CREATE POLICY "Owners can delete family members"
ON public.user_roles
FOR DELETE
USING (public.has_role(auth.uid(), 'owner') AND owner_id = auth.uid());

-- Update payment_cards RLS to allow family to view owner's cards
DROP POLICY IF EXISTS "Users can view own cards" ON public.payment_cards;
CREATE POLICY "Users can view own or owner cards"
ON public.payment_cards
FOR SELECT
USING (
  auth.uid() = user_id 
  OR user_id = public.get_owner_id(auth.uid())
);

-- Update shipping_addresses RLS to allow family to view owner's addresses
DROP POLICY IF EXISTS "Users can view own addresses" ON public.shipping_addresses;
CREATE POLICY "Users can view own or owner addresses"
ON public.shipping_addresses
FOR SELECT
USING (
  auth.uid() = user_id 
  OR user_id = public.get_owner_id(auth.uid())
);