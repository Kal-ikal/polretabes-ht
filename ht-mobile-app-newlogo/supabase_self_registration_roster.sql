-- =====================================================================
-- SQL SCRIPT: SELF-REGISTRATION VIA PRE-VERIFIED NRP (PERSONNEL ROSTER)
-- Jalankan script ini di Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
-- =====================================================================

-- 1. Buat Tabel Roster Personel Kepolisian
CREATE TABLE IF NOT EXISTS public.personnel_roster (
  nrp TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_registered BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pastikan kolom status ada pada tabel profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE';

-- 2. Aktifkan RLS pada personnel_roster
ALTER TABLE public.personnel_roster ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins have full access to personnel_roster" ON public.personnel_roster;
CREATE POLICY "Admins have full access to personnel_roster"
  ON public.personnel_roster
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- 3. Fungsi RPC Verifikasi NRP (SECURITY DEFINER)
DROP FUNCTION IF EXISTS public.verify_nrp_for_registration(TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.verify_nrp_for_registration(p_nrp TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_exists BOOLEAN;
  v_trimmed TEXT := TRIM(p_nrp);
BEGIN
  IF v_trimmed = '' OR v_trimmed IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM public.personnel_roster
    WHERE nrp = v_trimmed AND is_registered = false
  ) INTO v_exists;

  RETURN v_exists;
END;
$$;

-- 4. Trigger Function handle_new_user() untuk Self-Registration
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_nrp TEXT;
  v_roster_name TEXT;
  v_full_name TEXT;
BEGIN
  v_nrp := TRIM(COALESCE(new.raw_user_meta_data->>'nrp', ''));

  -- Ambil nama resmi dari roster jika ada
  IF v_nrp <> '' THEN
    SELECT name INTO v_roster_name FROM public.personnel_roster WHERE nrp = v_nrp LIMIT 1;
  END IF;

  v_full_name := COALESCE(v_roster_name, new.raw_user_meta_data->>'full_name', SPLIT_PART(new.email, '@', 1));

  -- Insert profile baru dengan role 'petugas' dan status 'PENDING'
  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    nrp,
    role,
    status,
    created_at
  ) VALUES (
    new.id,
    new.email,
    v_full_name,
    NULLIF(v_nrp, ''),
    'petugas',
    'PENDING',
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    nrp = EXCLUDED.nrp,
    role = 'petugas';

  -- Tandai NRP sudah terdaftar di roster
  IF v_nrp <> '' THEN
    UPDATE public.personnel_roster
    SET is_registered = true
    WHERE nrp = v_nrp;
  END IF;

  RETURN new;
END;
$$;

-- Pasang Trigger pada auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 5. Seed Data Pra-Verifikasi Roster Personel untuk Pengujian
INSERT INTO public.personnel_roster (nrp, name, is_registered)
VALUES
  ('78010234', 'Bripka Budi Santoso', false),
  ('82050678', 'Aipda Siti Rahma', false),
  ('85030491', 'Briptu Agus Wijaya', false),
  ('79110823', 'Aiptu Hendra Gunawan', false),
  ('88020304', 'Brigadir Dedi Kurniawan', false),
  ('91030506', 'Briptu Eko Prasetyo', false),
  ('99010111', 'Bripda Riski Hamdani', false)
ON CONFLICT (nrp) DO UPDATE SET
  name = EXCLUDED.name,
  is_registered = EXCLUDED.is_registered;

-- 6. Tampilkan Daftar Roster Personel
SELECT * FROM public.personnel_roster ORDER BY nrp ASC;
