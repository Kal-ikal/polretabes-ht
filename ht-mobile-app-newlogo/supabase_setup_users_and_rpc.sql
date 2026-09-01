-- =====================================================================
-- SQL SCRIPT (CLEAN VERSION WITH DROP FUNCTION)
-- Jalankan script ini di Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
-- =====================================================================

-- 1. Pastikan ekstensi pgcrypto aktif
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. DROP FUNCTION lama jika tipe return berbeda (Mencegah ERROR 42P13)
DROP FUNCTION IF EXISTS public.admin_create_user_account(TEXT, TEXT, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.admin_update_user_role(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.admin_update_user_role(TEXT, UUID) CASCADE;
DROP FUNCTION IF EXISTS public.approve_transaction(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.reject_transaction(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.get_email_by_identifier(TEXT) CASCADE;

-- 3. Fungsi Admin: Buat Akun Pengguna Baru
CREATE OR REPLACE FUNCTION public.admin_create_user_account(
  p_email TEXT,
  p_password TEXT,
  p_full_name TEXT,
  p_nrp TEXT,
  p_role TEXT DEFAULT 'petugas'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id UUID;
  v_encrypted_pw TEXT;
  v_now TIMESTAMPTZ := NOW();
  v_clean_email TEXT;
BEGIN
  v_clean_email := LOWER(TRIM(p_email));
  IF v_clean_email NOT LIKE '%@%' THEN
    v_clean_email := v_clean_email || '@ht.id';
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE email = v_clean_email;
  v_encrypted_pw := crypt(p_password, gen_salt('bf', 10));

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();
    
    INSERT INTO auth.users (
      id,
      instance_id,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      role,
      aud,
      confirmation_token
    ) VALUES (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      v_clean_email,
      v_encrypted_pw,
      v_now,
      jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
      jsonb_build_object('full_name', p_full_name, 'nrp', p_nrp),
      v_now,
      v_now,
      'authenticated',
      'authenticated',
      encode(gen_random_bytes(32), 'hex')
    );

    INSERT INTO auth.identities (
      id,
      user_id,
      identity_data,
      provider,
      provider_id,
      last_sign_in_at,
      created_at,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      v_user_id,
      jsonb_build_object('sub', v_user_id::text, 'email', v_clean_email),
      'email',
      v_user_id::text,
      v_now,
      v_now,
      v_now
    ) ON CONFLICT DO NOTHING;
  ELSE
    UPDATE auth.users
    SET 
      encrypted_password = v_encrypted_pw,
      raw_user_meta_data = jsonb_build_object('full_name', p_full_name, 'nrp', p_nrp),
      updated_at = v_now
    WHERE id = v_user_id;
  END IF;

  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    nrp,
    role,
    created_at
  ) VALUES (
    v_user_id,
    v_clean_email,
    p_full_name,
    p_nrp,
    p_role,
    v_now
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    nrp = EXCLUDED.nrp,
    role = EXCLUDED.role;

  RETURN jsonb_build_object(
    'success', true,
    'user_id', v_user_id,
    'email', v_clean_email,
    'full_name', p_full_name,
    'nrp', p_nrp,
    'role', p_role
  );
END;
$$;

-- 4. Fungsi Admin: Update Role User (Bypass RLS)
CREATE OR REPLACE FUNCTION public.admin_update_user_role(
  p_user_id UUID,
  p_new_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF p_new_role NOT IN ('admin', 'petugas') THEN
    RAISE EXCEPTION 'Role tidak valid. Harus admin atau petugas.';
  END IF;

  UPDATE public.profiles
  SET role = p_new_role
  WHERE id = p_user_id;

  RETURN jsonb_build_object('success', true, 'user_id', p_user_id, 'role', p_new_role);
END;
$$;

-- 5. Fungsi Admin: Persetujuan Transaksi (BORROW & RETURN)
CREATE OR REPLACE FUNCTION public.approve_transaction(p_transaction_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_tx RECORD;
  v_admin_id UUID := auth.uid();
  v_now TIMESTAMPTZ := NOW();
  v_target_state TEXT;
BEGIN
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id;

  IF v_tx IS NULL THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan.';
  END IF;

  IF v_tx.status != 'PENDING' THEN
    RAISE EXCEPTION 'Transaksi ini tidak dalam status menunggu persetujuan.';
  END IF;

  -- Pastikan admin_id memiliki record profile untuk mencegah foreign key violation
  IF v_admin_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, full_name, role, status)
    VALUES (v_admin_id, 'Admin Logistik TIK', 'admin', 'APPROVED')
    ON CONFLICT (id) DO UPDATE SET role = 'admin', status = 'APPROVED';
  END IF;

  UPDATE public.transactions
  SET 
    status = 'APPROVED',
    reviewed_by = v_admin_id,
    reviewed_at = v_now,
    updated_at = v_now
  WHERE id = p_transaction_id;

  IF v_tx.action = 'BORROW' THEN
    UPDATE public.assets SET status = 'dipinjam', updated_at = v_now WHERE id = v_tx.asset_id;
    
    BEGIN
      INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
      VALUES (v_tx.asset_id, 'tersedia', 'dipinjam', v_admin_id, 'Peminjaman disetujui oleh admin');
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Log asset_state_logs dilewati: %', SQLERRM;
    END;
  
  ELSIF v_tx.action = 'RETURN' THEN
    v_target_state := CASE WHEN LOWER(COALESCE(v_tx.condition, 'baik')) = 'rusak' THEN 'rusak' ELSE 'tersedia' END;
    
    UPDATE public.assets SET status = v_target_state, updated_at = v_now WHERE id = v_tx.asset_id;
    
    BEGIN
      INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
      VALUES (v_tx.asset_id, 'dipinjam', v_target_state, v_admin_id, 'Pengembalian disetujui oleh admin');
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Log asset_state_logs dilewati: %', SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object('success', true, 'transaction_id', p_transaction_id, 'status', 'APPROVED');
END;
$$;

-- 6. Fungsi Admin: Penolakan Transaksi
CREATE OR REPLACE FUNCTION public.reject_transaction(
  p_transaction_id UUID,
  p_reason TEXT DEFAULT 'Ditolak oleh admin'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_tx RECORD;
  v_admin_id UUID := auth.uid();
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id;

  IF v_tx IS NULL THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan.';
  END IF;

  IF v_tx.status != 'PENDING' THEN
    RAISE EXCEPTION 'Transaksi ini tidak dalam status menunggu persetujuan.';
  END IF;

  IF v_admin_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, full_name, role, status)
    VALUES (v_admin_id, 'Admin Logistik TIK', 'admin', 'APPROVED')
    ON CONFLICT (id) DO UPDATE SET role = 'admin', status = 'APPROVED';
  END IF;

  UPDATE public.transactions
  SET 
    status = 'REJECTED',
    rejection_reason = p_reason,
    reviewed_by = v_admin_id,
    reviewed_at = v_now,
    updated_at = v_now
  WHERE id = p_transaction_id;

  RETURN jsonb_build_object('success', true, 'transaction_id', p_transaction_id, 'status', 'REJECTED');
END;
$$;

-- 7. Fungsi Resolver Identifier Login (Nickname / Email / NRP / Nama)
CREATE OR REPLACE FUNCTION public.get_email_by_identifier(p_identifier TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_email TEXT;
  v_trimmed TEXT := TRIM(p_identifier);
BEGIN
  SELECT email INTO v_email FROM public.profiles WHERE LOWER(email) = LOWER(v_trimmed) LIMIT 1;
  IF v_email IS NOT NULL THEN RETURN v_email; END IF;

  SELECT email INTO v_email FROM public.profiles WHERE LOWER(SPLIT_PART(email, '@', 1)) = LOWER(v_trimmed) LIMIT 1;
  IF v_email IS NOT NULL THEN RETURN v_email; END IF;

  SELECT email INTO v_email FROM public.profiles WHERE LOWER(nrp) = LOWER(v_trimmed) LIMIT 1;
  IF v_email IS NOT NULL THEN RETURN v_email; END IF;

  SELECT email INTO v_email FROM public.profiles WHERE full_name ILIKE '%' || v_trimmed || '%' LIMIT 1;
  IF v_email IS NOT NULL THEN RETURN v_email; END IF;

  IF v_trimmed NOT LIKE '%@%' THEN
    RETURN LOWER(v_trimmed) || '@ht.id';
  END IF;

  RETURN v_trimmed;
END;
$$;

-- 8. Setup / Sinkronkan Akun-Akun Anggota (Password: password123)
SELECT public.admin_create_user_account('admin@ht.id', 'password123', 'Admin Logistik TIK', 'Admin', 'admin');
SELECT public.admin_create_user_account('petugas@example.com', 'password123', 'Riski Hamdani', 'Bripda', 'petugas');
SELECT public.admin_create_user_account('budi@ht.id', 'password123', 'Bripka Budi Santoso', '78010234', 'petugas');
SELECT public.admin_create_user_account('siti@ht.id', 'password123', 'Aipda Siti Rahma', '82050678', 'petugas');
SELECT public.admin_create_user_account('agus@ht.id', 'password123', 'Briptu Agus Wijaya', '85030491', 'petugas');
SELECT public.admin_create_user_account('hendra@ht.id', 'password123', 'Aiptu Hendra Gunawan', '79110823', 'petugas');

-- 9. Bersihkan transaksi gantung Baofeng UV-5R jika ada
UPDATE public.transactions 
SET status = 'APPROVED' 
WHERE status = 'PENDING' AND asset_id = '3c7a7754-9af2-4a17-8c54-02303dfb2779';

UPDATE public.assets 
SET status = 'tersedia' 
WHERE id = '3c7a7754-9af2-4a17-8c54-02303dfb2779';

-- 10. Tampilkan Seluruh Akun Terdaftar
SELECT id, email, full_name, nrp, role FROM public.profiles ORDER BY role DESC, full_name ASC;
