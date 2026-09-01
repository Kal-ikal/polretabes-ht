-- =====================================================================
-- SQL SCRIPT: OPEN REGISTRATION + STRICT MANUAL APPROVAL TRIGGER
-- Jalankan script ini di Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
-- =====================================================================

-- 1. Pastikan kolom status ada pada tabel profiles dengan default 'PENDING'
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PENDING';

-- 2. Trigger Function handle_new_user() untuk Self-Registration Mandiri
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_name TEXT;
  v_nrp TEXT;
  v_role TEXT;
  v_status TEXT;
BEGIN
  -- Ekstrak nama lengkap dari raw_user_meta_data (mendukung key 'full_name' atau 'name')
  v_name := COALESCE(
    NULLIF(TRIM(new.raw_user_meta_data->>'full_name'), ''),
    NULLIF(TRIM(new.raw_user_meta_data->>'name'), ''),
    SPLIT_PART(new.email, '@', 1)
  );

  -- Ekstrak NRP dari raw_user_meta_data
  v_nrp := NULLIF(TRIM(COALESCE(new.raw_user_meta_data->>'nrp', '')), '');

  -- Default role ke 'petugas' kecuali jika ditentukan secara eksplisit di metadata
  v_role := COALESCE(NULLIF(TRIM(new.raw_user_meta_data->>'role'), ''), 'petugas');

  -- Default status ke 'PENDING' untuk pendaftaran mandiri
  v_status := COALESCE(NULLIF(TRIM(new.raw_user_meta_data->>'status'), ''), 'PENDING');

  -- Masukkan ke tabel public.profiles
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
    v_name,
    v_nrp,
    v_role,
    v_status,
    NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), public.profiles.full_name),
    nrp = COALESCE(NULLIF(EXCLUDED.nrp, ''), public.profiles.nrp),
    role = COALESCE(public.profiles.role, EXCLUDED.role),
    status = COALESCE(public.profiles.status, EXCLUDED.status);

  RETURN new;
END;
$$;

-- 3. Pasang Trigger pada auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. Verifikasi Struktur Tabel Profiles
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'profiles' AND table_schema = 'public';
