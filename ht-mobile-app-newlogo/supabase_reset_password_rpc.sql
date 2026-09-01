-- =====================================================================
-- SQL SCRIPT: ADMIN RESET USER PASSWORD PROCEDURE
-- Jalankan script ini di Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
-- =====================================================================

-- 1. Pastikan ekstensi pgcrypto aktif
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. DROP FUNCTION lama jika ada
DROP FUNCTION IF EXISTS public.admin_reset_user_password(UUID, TEXT) CASCADE;

-- 3. Fungsi Admin: Reset Password Pengguna secara Langsung
CREATE OR REPLACE FUNCTION public.admin_reset_user_password(
  p_user_id UUID,
  p_new_password TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_encrypted_pw TEXT;
BEGIN
  IF p_new_password IS NULL OR LENGTH(TRIM(p_new_password)) < 6 THEN
    RAISE EXCEPTION 'Kata sandi baru minimal 6 karakter.';
  END IF;

  v_encrypted_pw := crypt(TRIM(p_new_password), gen_salt('bf', 10));

  UPDATE auth.users
  SET 
    encrypted_password = v_encrypted_pw,
    updated_at = NOW()
  WHERE id = p_user_id;

  RETURN jsonb_build_object('success', true, 'user_id', p_user_id);
END;
$$;
