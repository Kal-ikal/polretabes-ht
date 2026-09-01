-- =====================================================================
-- BATCH BORROWING MIGRATION & RPC FUNCTIONS (UP TO 50 HTs AT ONCE)
-- Jalankan script ini di Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
-- =====================================================================

-- 1. Tambahkan kolom batch_id dan batch_code ke tabel transactions
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS batch_id UUID DEFAULT NULL;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS batch_code TEXT DEFAULT NULL;

-- Indeks untuk mempercepat pencarian berdasarkan batch_id dan batch_code
CREATE INDEX IF NOT EXISTS idx_transactions_batch_id ON public.transactions(batch_id);
CREATE INDEX IF NOT EXISTS idx_transactions_batch_code ON public.transactions(batch_code);

-- 2. Clean up RPC lama jika ada
DROP FUNCTION IF EXISTS public.process_batch_asset_transaction(UUID[], TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.approve_batch_transaction(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.reject_batch_transaction(UUID, TEXT) CASCADE;

-- 3. RPC: process_batch_asset_transaction
-- Memproses peminjaman hingga 50 HT sekaligus untuk 1 peminjam dengan batch_id yang sama
CREATE OR REPLACE FUNCTION public.process_batch_asset_transaction(
  p_asset_ids UUID[],
  p_action TEXT DEFAULT 'BORROW',
  p_borrower_name TEXT DEFAULT NULL,
  p_borrower_nrp TEXT DEFAULT NULL,
  p_kesatuan TEXT DEFAULT NULL,
  p_condition TEXT DEFAULT 'baik',
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_batch_id UUID := gen_random_uuid();
  v_batch_code TEXT := 'BATCH-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || SUBSTRING(v_batch_id::text FROM 1 FOR 6);
  v_asset_id UUID;
  v_count INTEGER;
  v_asset_record RECORD;
  v_pending_count INTEGER;
  v_now TIMESTAMPTZ := NOW();
  v_created_tx_ids UUID[] := ARRAY[]::UUID[];
  v_new_tx_id UUID;
BEGIN
  -- Validasi jumlah aset (1 s/d 50 HT)
  v_count := CARDINALITY(p_asset_ids);
  IF v_count IS NULL OR v_count < 1 THEN
    RAISE EXCEPTION 'Minimal 1 unit HT harus dipilih.';
  END IF;

  IF v_count > 50 THEN
    RAISE EXCEPTION 'Batas maksimal peminjaman sekaligus adalah 50 unit HT (Anda memilih % unit).', v_count;
  END IF;

  -- Pastikan user_id memiliki record profile untuk foreign key
  IF v_user_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, full_name, role)
    VALUES (v_user_id, COALESCE(p_borrower_name, 'Petugas Logistik'), 'petugas')
    ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Iterasi setiap asset_id yang diajukan
  FOREACH v_asset_id IN ARRAY p_asset_ids
  LOOP
    -- 1. Cek status aset saat ini
    SELECT id, code, name, status INTO v_asset_record
    FROM public.assets
    WHERE id = v_asset_id;

    IF v_asset_record IS NULL THEN
      RAISE EXCEPTION 'Unit HT dengan ID % tidak ditemukan.', v_asset_id;
    END IF;

    IF LOWER(COALESCE(v_asset_record.status::text, '')) != 'tersedia' THEN
      RAISE EXCEPTION 'Unit HT "%" (%) saat ini berstatus % dan tidak tersedia untuk dipinjam.', 
        v_asset_record.name, v_asset_record.code, UPPER(COALESCE(v_asset_record.status::text, 'tersedia'));
    END IF;

    -- 2. Cek apakah ada permohonan PENDING aktif untuk unit ini
    SELECT COUNT(*) INTO v_pending_count
    FROM public.transactions
    WHERE asset_id = v_asset_id
      AND status = 'PENDING'
      AND action = 'BORROW';

    IF v_pending_count > 0 THEN
      RAISE EXCEPTION 'Unit HT "%" (%) sedang menunggu persetujuan permohonan lain.', 
        v_asset_record.name, v_asset_record.code;
    END IF;

    -- 3. Buat record transaksi peminjaman baru
    v_new_tx_id := gen_random_uuid();

    INSERT INTO public.transactions (
      id,
      asset_id,
      user_id,
      borrower_name,
      borrower_nrp,
      kesatuan,
      action,
      status,
      condition,
      notes,
      batch_id,
      batch_code,
      created_at,
      updated_at
    ) VALUES (
      v_new_tx_id,
      v_asset_id,
      v_user_id,
      TRIM(p_borrower_name),
      TRIM(p_borrower_nrp),
      TRIM(p_kesatuan),
      p_action,
      'PENDING',
      p_condition,
      p_notes,
      v_batch_id,
      v_batch_code,
      v_now,
      v_now
    );

    v_created_tx_ids := ARRAY_APPEND(v_created_tx_ids, v_new_tx_id);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', v_batch_id,
    'batch_code', v_batch_code,
    'total_items', v_count,
    'transaction_ids', v_created_tx_ids
  );
END;
$$;

-- 4. RPC: approve_batch_transaction
-- Memproses persetujuan seluruh transaksi dalam 1 batch sekaligus oleh Admin
CREATE OR REPLACE FUNCTION public.approve_batch_transaction(p_batch_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_now TIMESTAMPTZ := NOW();
  v_tx RECORD;
  v_approved_count INTEGER := 0;
  v_target_state TEXT;
BEGIN
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'Batch ID wajib diisi.';
  END IF;

  -- Pastikan profil admin ada untuk mencegah kesalahan foreign key
  IF v_admin_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, full_name, role, status)
    VALUES (v_admin_id, 'Admin Logistik TIK', 'admin', 'APPROVED')
    ON CONFLICT (id) DO UPDATE SET role = 'admin', status = 'APPROVED';
  END IF;

  FOR v_tx IN 
    SELECT * FROM public.transactions 
    WHERE batch_id = p_batch_id AND status = 'PENDING'
  LOOP
    -- Update status transaksi
    UPDATE public.transactions
    SET 
      status = 'APPROVED',
      reviewed_by = v_admin_id,
      reviewed_at = v_now,
      updated_at = v_now
    WHERE id = v_tx.id;

    -- Update status aset & buat log FSM
    IF v_tx.action = 'BORROW' THEN
      -- Transaksi disetujui admin (APPROVED), aset siap di-scan untuk serah terima fisik di gudang
      BEGIN
        INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
        VALUES (v_tx.asset_id, 'tersedia', 'disetujui', v_admin_id, 'Permohonan batch disetujui admin (' || COALESCE(v_tx.batch_code, '') || '). Menunggu scan serah terima fisik.');
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Asset state log skipped: %', SQLERRM;
      END;

    ELSIF v_tx.action = 'RETURN' THEN
      v_target_state := CASE WHEN LOWER(COALESCE(v_tx.condition, 'baik')) = 'rusak' THEN 'rusak' ELSE 'tersedia' END;
      UPDATE public.assets SET status = v_target_state, updated_at = v_now WHERE id = v_tx.asset_id;

      BEGIN
        INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
        VALUES (v_tx.asset_id, 'dipinjam', v_target_state, v_admin_id, 'Pengembalian batch disetujui admin (' || COALESCE(v_tx.batch_code, '') || ')');
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Asset state log skipped: %', SQLERRM;
      END;
    END IF;

    v_approved_count := v_approved_count + 1;
  END LOOP;

  IF v_approved_count = 0 THEN
    RAISE EXCEPTION 'Tidak ada transaksi PENDING ditemukan untuk batch ini.';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'approved_count', v_approved_count
  );
END;
$$;

-- 5. RPC: reject_batch_transaction
-- Memproses penolakan seluruh transaksi dalam 1 batch sekaligus oleh Admin
CREATE OR REPLACE FUNCTION public.reject_batch_transaction(
  p_batch_id UUID,
  p_reason TEXT DEFAULT 'Ditolak oleh admin'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_now TIMESTAMPTZ := NOW();
  v_rejected_count INTEGER := 0;
BEGIN
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'Batch ID wajib diisi.';
  END IF;

  IF v_admin_id IS NOT NULL THEN
    INSERT INTO public.profiles (id, full_name, role, status)
    VALUES (v_admin_id, 'Admin Logistik TIK', 'admin', 'APPROVED')
    ON CONFLICT (id) DO UPDATE SET role = 'admin', status = 'APPROVED';
  END IF;

  UPDATE public.transactions
  SET 
    status = 'REJECTED',
    rejection_reason = TRIM(p_reason),
    reviewed_by = v_admin_id,
    reviewed_at = v_now,
    updated_at = v_now
  WHERE batch_id = p_batch_id AND status = 'PENDING';

  GET DIAGNOSTICS v_rejected_count = ROW_COUNT;

  IF v_rejected_count = 0 THEN
    RAISE EXCEPTION 'Tidak ada transaksi PENDING ditemukan untuk batch ini.';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'rejected_count', v_rejected_count
  );
END;
$$;

-- 6. Berikan izin eksekusi RPC ke authenticated & anon
GRANT EXECUTE ON FUNCTION public.process_batch_asset_transaction(UUID[], TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.approve_batch_transaction(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reject_batch_transaction(UUID, TEXT) TO authenticated, anon, service_role;
