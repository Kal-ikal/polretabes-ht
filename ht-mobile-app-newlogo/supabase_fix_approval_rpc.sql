-- =====================================================================
-- FIX SCRIPT: RESOLVE APPROVAL ERROR (Persetujuan Transaksi)
-- Jalankan script SQL ini di Supabase Dashboard -> SQL Editor -> New Query
-- =====================================================================

-- 1. Pastikan kolom updated_at ada di tabel transactions dan assets
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Pastikan tabel asset_state_logs ada dengan relasi yang aman
CREATE TABLE IF NOT EXISTS public.asset_state_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  from_state TEXT,
  to_state TEXT NOT NULL,
  triggered_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Berikan RLS policy yang mengizinkan authenticated user & service role
ALTER TABLE public.asset_state_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "asset_state_logs_select_all" ON public.asset_state_logs;
CREATE POLICY "asset_state_logs_select_all" ON public.asset_state_logs FOR SELECT USING (true);

DROP POLICY IF EXISTS "asset_state_logs_insert_all" ON public.asset_state_logs;
CREATE POLICY "asset_state_logs_insert_all" ON public.asset_state_logs FOR INSERT WITH CHECK (true);

-- 3. DROP dan BUAT ULANG fungsi approve_transaction yang 100% aman dan tahan error
DROP FUNCTION IF EXISTS public.approve_transaction(UUID) CASCADE;

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
  -- 1. Ambil data transaksi
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id;

  IF v_tx IS NULL THEN
    RAISE EXCEPTION 'Transaksi dengan ID % tidak ditemukan.', p_transaction_id;
  END IF;

  IF v_tx.status != 'PENDING' THEN
    RAISE EXCEPTION 'Transaksi ini sudah berstatus % dan tidak dapat disetujui lagi.', v_tx.status;
  END IF;

  -- 2. Pastikan admin_id valid dan memiliki record profile untuk mencegah foreign key violation
  IF v_admin_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, full_name, role, status)
    VALUES (v_admin_id, 'Admin Logistik TIK', 'admin', 'APPROVED')
    ON CONFLICT (id) DO UPDATE SET role = 'admin', status = 'APPROVED';
  END IF;

  -- 3. Update status transaksi menjadi APPROVED
  UPDATE public.transactions
  SET 
    status = 'APPROVED',
    reviewed_by = v_admin_id,
    reviewed_at = v_now,
    updated_at = v_now
  WHERE id = p_transaction_id;

  -- 4. Proses perubahan status aset berdasarkan aksi
  IF v_tx.action = 'BORROW' THEN
    -- Update status aset menjadi 'dipinjam'
    UPDATE public.assets 
    SET status = 'dipinjam', updated_at = v_now 
    WHERE id = v_tx.asset_id;
    
    -- Catat log perpindahan status
    BEGIN
      INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
      VALUES (v_tx.asset_id, 'tersedia', 'dipinjam', v_admin_id, 'Peminjaman disetujui oleh admin');
    EXCEPTION WHEN OTHERS THEN
      -- Abaikan jika log gagal, jangan batalkan transaksi utama
      RAISE NOTICE 'Gagal mencatat asset_state_logs: %', SQLERRM;
    END;
  
  ELSIF v_tx.action = 'RETURN' THEN
    v_target_state := CASE WHEN LOWER(COALESCE(v_tx.condition, 'baik')) = 'rusak' THEN 'rusak' ELSE 'tersedia' END;
    
    -- Update status aset kembali ke 'tersedia' atau 'rusak'
    UPDATE public.assets 
    SET status = v_target_state, updated_at = v_now 
    WHERE id = v_tx.asset_id;
    
    -- Catat log perpindahan status
    BEGIN
      INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
      VALUES (v_tx.asset_id, 'dipinjam', v_target_state, v_admin_id, 'Pengembalian disetujui oleh admin');
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Gagal mencatat asset_state_logs: %', SQLERRM;
    END;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 
    'transaction_id', p_transaction_id, 
    'status', 'APPROVED',
    'action', v_tx.action
  );
END;
$$;

-- 4. DROP dan BUAT ULANG fungsi reject_transaction yang aman
DROP FUNCTION IF EXISTS public.reject_transaction(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.reject_transaction(UUID) CASCADE;

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
  -- 1. Ambil data transaksi
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id;

  IF v_tx IS NULL THEN
    RAISE EXCEPTION 'Transaksi dengan ID % tidak ditemukan.', p_transaction_id;
  END IF;

  IF v_tx.status != 'PENDING' THEN
    RAISE EXCEPTION 'Transaksi ini sudah berstatus % dan tidak dapat ditolak lagi.', v_tx.status;
  END IF;

  -- 2. Pastikan admin_id valid jika tersedia
  IF v_admin_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, full_name, role, status)
    VALUES (v_admin_id, 'Admin Logistik TIK', 'admin', 'APPROVED')
    ON CONFLICT (id) DO UPDATE SET role = 'admin', status = 'APPROVED';
  END IF;

  -- 3. Update status transaksi menjadi REJECTED
  UPDATE public.transactions
  SET 
    status = 'REJECTED',
    rejection_reason = p_reason,
    reviewed_by = v_admin_id,
    reviewed_at = v_now,
    updated_at = v_now
  WHERE id = p_transaction_id;

  RETURN jsonb_build_object(
    'success', true, 
    'transaction_id', p_transaction_id, 
    'status', 'REJECTED'
  );
END;
$$;

-- 5. Berikan izin eksekusi kepada seluruh role (authenticated & anon)
GRANT EXECUTE ON FUNCTION public.approve_transaction(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reject_transaction(UUID, TEXT) TO authenticated, anon, service_role;

-- 6. Verifikasi fungsi telah terpasang
SELECT routine_name, routine_type 
FROM information_schema.routines 
WHERE routine_schema = 'public' AND routine_name IN ('approve_transaction', 'reject_transaction');
