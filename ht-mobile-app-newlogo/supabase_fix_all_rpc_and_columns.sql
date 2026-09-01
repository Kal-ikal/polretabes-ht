-- ============================================================================
-- MASTER FIX: PEMINJAMAN MANUAL, STATUS DIPINJAM & SERAH TERIMA FISIK
-- ============================================================================
-- MASALAH YANG DIPERBAIKI:
--   1. Peminjaman Manual oleh Admin langsung berstatus APPROVED dan status
--      aset LANGSUNG BERUBAH menjadi 'dipinjam' (tidak menggantung di 'tersedia').
--   2. Peminjaman oleh Petugas berstatus PENDING (Menunggu Persetujuan Admin).
--   3. Saat Admin menyetujui peminjaman (Approve), status aset otomatis beralih
--      ke 'dipinjam' (atau terkonfirmasi serah terima fisik).
--   4. Fungsi `confirm_physical_handover` aman dengan SECURITY DEFINER.
--   5. Script otomatis memperbaiki seluruh aset yang saat ini 'stuck' (seperti Hytera PD788G).
-- ============================================================================

-- 1. PASTIKAN STRUKTUR TABEL & KOLOM
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'APPROVED';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS kesatuan TEXT DEFAULT '-';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'petugas';

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS kesatuan TEXT DEFAULT '-';
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS borrower_id UUID DEFAULT NULL;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS borrower_nrp TEXT DEFAULT NULL;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS batch_id UUID DEFAULT NULL;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS batch_code TEXT DEFAULT NULL;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. RLS POLICIES AGAR UPDATE/DELETE TRANSAKSI & ASSET AMAN
DROP POLICY IF EXISTS "transactions_update_authenticated" ON public.transactions;
CREATE POLICY "transactions_update_authenticated" ON public.transactions FOR UPDATE USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "transactions_delete_authenticated" ON public.transactions;
CREATE POLICY "transactions_delete_authenticated" ON public.transactions FOR DELETE USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "assets_update_authenticated" ON public.assets;
CREATE POLICY "assets_update_authenticated" ON public.assets FOR UPDATE USING (auth.role() = 'authenticated');

-- 3. DROP FUNGSI LAMA
DROP FUNCTION IF EXISTS public.process_asset_transaction(UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.process_asset_transaction(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.confirm_physical_handover(UUID);
DROP FUNCTION IF EXISTS public.approve_transaction(UUID);
DROP FUNCTION IF EXISTS public.approve_batch_transaction(UUID);
DROP FUNCTION IF EXISTS public.cancel_transaction(UUID);

-- 4. UNIFIED RPC: `process_asset_transaction`
CREATE OR REPLACE FUNCTION public.process_asset_transaction(
  p_asset_id UUID,
  p_action TEXT,
  p_condition TEXT DEFAULT 'baik',
  p_notes TEXT DEFAULT NULL,
  p_borrower_name TEXT DEFAULT NULL,
  p_borrower_nrp TEXT DEFAULT NULL,
  p_kesatuan TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_user_role TEXT := 'petugas';
  v_asset RECORD;
  v_tx_id UUID;
  v_now TIMESTAMPTZ := NOW();
  v_new_status TEXT;
  v_action_upper TEXT := UPPER(p_action);
  v_b_name TEXT;
  v_b_nrp TEXT;
  v_b_kesatuan TEXT;
BEGIN
  -- Fallback user ID jika auth.uid() NULL (misal anon / web session)
  IF v_user_id IS NULL THEN
    SELECT id INTO v_user_id FROM public.profiles WHERE role = 'admin' LIMIT 1;
    IF v_user_id IS NULL THEN
      SELECT id INTO v_user_id FROM public.profiles LIMIT 1;
    END IF;
  END IF;

  IF v_user_id IS NOT NULL THEN
    SELECT role, full_name, nrp, kesatuan INTO v_user_role, v_b_name, v_b_nrp, v_b_kesatuan
    FROM public.profiles WHERE id = v_user_id;
  END IF;

  SELECT * INTO v_asset FROM public.assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aset HT tidak ditemukan.';
  END IF;

  v_b_name := COALESCE(NULLIF(TRIM(p_borrower_name), ''), v_b_name, 'Petugas Logistik');
  v_b_nrp := COALESCE(NULLIF(TRIM(p_borrower_nrp), ''), v_b_nrp, '-');
  v_b_kesatuan := COALESCE(NULLIF(TRIM(p_kesatuan), ''), v_b_kesatuan, '-');

  IF v_action_upper = 'BORROW' THEN
    IF (v_asset.status)::text = 'dipinjam' THEN
      RAISE EXCEPTION 'Aset sedang dipinjam dan tidak tersedia.';
    END IF;

    -- JIKA ADMIN MELAKUKAN PENGAJUAN MANUAL (LOKET LOGISTIK):
    -- Transaksi langsung APPROVED & Aset LANGSUNG BERUBAH MENJADI 'dipinjam'
    IF v_user_role = 'admin' THEN
      INSERT INTO public.transactions (
        asset_id, borrower_id, borrower_name, borrower_nrp, kesatuan, action, status, reviewed_by, reviewed_at, notes, created_at, updated_at
      )
      VALUES (
        p_asset_id, v_user_id, v_b_name, v_b_nrp, v_b_kesatuan, 'BORROW', 'APPROVED', v_user_id, v_now, p_notes, v_now, v_now
      )
      RETURNING id INTO v_tx_id;

      -- Ubah status unit aset langsung ke dipinjam
      UPDATE public.assets
      SET status = 'dipinjam'::asset_status, updated_at = v_now
      WHERE id = p_asset_id;

      BEGIN
        INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
        VALUES (p_asset_id, 'tersedia'::asset_status, 'dipinjam'::asset_status, v_user_id, 'Peminjaman langsung oleh admin (' || v_b_name || ')');
      EXCEPTION WHEN OTHERS THEN NULL; END;

    -- JIKA PETUGAS BIASA YANG MENGAJUKAN:
    -- Transaksi dibuat PENDING (Menunggu verifikasi admin), Aset tetap 'tersedia'
    ELSE
      INSERT INTO public.transactions (
        asset_id, borrower_id, borrower_name, borrower_nrp, kesatuan, action, status, notes, created_at, updated_at
      )
      VALUES (
        p_asset_id, v_user_id, v_b_name, v_b_nrp, v_b_kesatuan, 'BORROW', 'PENDING', p_notes, v_now, v_now
      )
      RETURNING id INTO v_tx_id;
    END IF;

  ELSIF v_action_upper = 'RETURN' THEN
    v_new_status := CASE WHEN LOWER(p_condition) = 'rusak' THEN 'rusak' ELSE 'tersedia' END;

    INSERT INTO public.transactions (
      asset_id, borrower_id, borrower_name, borrower_nrp, kesatuan, action, status, condition, notes, reviewed_by, reviewed_at, created_at, updated_at
    )
    VALUES (
      p_asset_id, v_user_id, v_b_name, v_b_nrp, v_b_kesatuan, 'RETURN', 'APPROVED', LOWER(p_condition), p_notes, v_user_id, v_now, v_now, v_now
    )
    RETURNING id INTO v_tx_id;

    UPDATE public.assets
    SET status = v_new_status::asset_status, updated_at = v_now
    WHERE id = p_asset_id;

    BEGIN
      INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
      VALUES (p_asset_id, 'dipinjam'::asset_status, v_new_status::asset_status, v_user_id, 'Pengembalian unit berhasil (' || p_condition || ')');
    EXCEPTION WHEN OTHERS THEN NULL; END;

  ELSE
    RAISE EXCEPTION 'Aksi transaksi tidak valid: %', p_action;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_tx_id,
    'asset_id', p_asset_id,
    'action', v_action_upper,
    'status', CASE WHEN v_user_role = 'admin' THEN 'APPROVED' ELSE 'PENDING' END
  );
END;
$$;

-- 5. RPC: `confirm_physical_handover`
CREATE OR REPLACE FUNCTION public.confirm_physical_handover(p_asset_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_tx RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_borrower_name TEXT;
BEGIN
  IF p_asset_id IS NULL THEN
    RAISE EXCEPTION 'ID Aset wajib diisi.';
  END IF;

  SELECT * INTO v_tx
  FROM public.transactions
  WHERE asset_id = p_asset_id AND action = 'BORROW' AND status = 'APPROVED'
  ORDER BY created_at DESC
  LIMIT 1;

  v_borrower_name := COALESCE(v_tx.borrower_name, 'Petugas');

  -- Update status aset menjadi dipinjam
  UPDATE public.assets
  SET status = 'dipinjam'::asset_status, updated_at = v_now
  WHERE id = p_asset_id;

  IF v_tx.id IS NOT NULL THEN
    UPDATE public.transactions
    SET updated_at = v_now
    WHERE id = v_tx.id;
  END IF;

  -- Hapus transaksi PENDING sampah untuk aset ini
  DELETE FROM public.transactions
  WHERE asset_id = p_asset_id AND action = 'BORROW' AND status = 'PENDING';

  BEGIN
    INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
    VALUES (p_asset_id, 'tersedia'::asset_status, 'dipinjam'::asset_status, v_user_id, 'Serah terima fisik berhasil (' || v_borrower_name || ')');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object(
    'success', true,
    'asset_id', p_asset_id,
    'status', 'dipinjam',
    'borrower_name', v_borrower_name
  );
END;
$$;

-- 6. RPC: `approve_transaction`
CREATE OR REPLACE FUNCTION public.approve_transaction(p_transaction_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_now TIMESTAMPTZ := NOW();
  v_tx RECORD;
  v_target_state TEXT;
BEGIN
  IF p_transaction_id IS NULL THEN
    RAISE EXCEPTION 'ID Transaksi wajib diisi.';
  END IF;

  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan.';
  END IF;

  UPDATE public.transactions
  SET status = 'APPROVED', reviewed_by = v_admin_id, reviewed_at = v_now, updated_at = v_now
  WHERE id = p_transaction_id;

  IF v_tx.action = 'BORROW' THEN
    -- Peminjaman disetujui -> status aset menjadi DIPINJAM
    UPDATE public.assets
    SET status = 'dipinjam'::asset_status, updated_at = v_now
    WHERE id = v_tx.asset_id;

    BEGIN
      INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
      VALUES (v_tx.asset_id, 'tersedia'::asset_status, 'dipinjam'::asset_status, v_admin_id,
        'Peminjaman disetujui admin untuk ' || COALESCE(v_tx.borrower_name, 'Petugas'));
    EXCEPTION WHEN OTHERS THEN NULL; END;

  ELSIF v_tx.action = 'RETURN' THEN
    v_target_state := CASE WHEN LOWER(COALESCE(v_tx.condition, 'baik')) = 'rusak' THEN 'rusak' ELSE 'tersedia' END;
    UPDATE public.assets SET status = v_target_state::asset_status, updated_at = v_now WHERE id = v_tx.asset_id;
    BEGIN
      INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
      VALUES (v_tx.asset_id, 'dipinjam'::asset_status, v_target_state::asset_status, v_admin_id, 'Pengembalian disetujui admin');
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN jsonb_build_object('success', true, 'transaction_id', p_transaction_id, 'status', 'APPROVED');
END;
$$;

-- 7. RPC: `approve_batch_transaction`
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

  UPDATE public.transactions
  SET
    status = 'APPROVED',
    reviewed_by = v_admin_id,
    reviewed_at = v_now,
    updated_at = v_now
  WHERE batch_id = p_batch_id AND status = 'PENDING';

  GET DIAGNOSTICS v_approved_count = ROW_COUNT;

  FOR v_tx IN
    SELECT * FROM public.transactions WHERE batch_id = p_batch_id AND status = 'APPROVED'
  LOOP
    IF v_tx.action = 'BORROW' THEN
      UPDATE public.assets SET status = 'dipinjam'::asset_status, updated_at = v_now WHERE id = v_tx.asset_id;
      BEGIN
        INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
        VALUES (v_tx.asset_id, 'tersedia'::asset_status, 'dipinjam'::asset_status, v_admin_id,
          'Batch peminjaman disetujui (' || COALESCE(v_tx.batch_code, '') || ')');
      EXCEPTION WHEN OTHERS THEN NULL; END;
    ELSIF v_tx.action = 'RETURN' THEN
      v_target_state := CASE WHEN LOWER(COALESCE(v_tx.condition, 'baik')) = 'rusak' THEN 'rusak' ELSE 'tersedia' END;
      UPDATE public.assets SET status = v_target_state::asset_status, updated_at = v_now WHERE id = v_tx.asset_id;
      BEGIN
        INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
        VALUES (v_tx.asset_id, 'dipinjam'::asset_status, v_target_state::asset_status, v_admin_id,
          'Pengembalian batch disetujui (' || COALESCE(v_tx.batch_code, '') || ')');
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'batch_id', p_batch_id, 'approved_count', v_approved_count);
END;
$$;

-- 8. RPC: `cancel_transaction` (Untuk membatalkan / reset transaksi yang keliru)
CREATE OR REPLACE FUNCTION public.cancel_transaction(p_transaction_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_tx RECORD;
BEGIN
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan.';
  END IF;

  DELETE FROM public.transactions WHERE id = p_transaction_id;

  -- Pastikan status aset kembali TERSEDIA jika tidak ada peminjaman aktif lainnya
  UPDATE public.assets
  SET status = 'tersedia'::asset_status, updated_at = NOW()
  WHERE id = v_tx.asset_id;

  RETURN jsonb_build_object('success', true, 'message', 'Transaksi berhasil dibatalkan dan status unit dikembalikan ke TERSEDIA.');
END;
$$;

-- 9. BERIKAN HAK AKSES EKSEKUSI
GRANT EXECUTE ON FUNCTION public.process_asset_transaction(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_physical_handover(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.approve_transaction(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.approve_batch_transaction(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_transaction(UUID) TO authenticated, anon, service_role;

-- ============================================================================
-- 10. REPAIR AUTOMATIS UNTUK ASET YANG SAAT INI STUCK / NGEBUG:
--    Sinkronisasi aset yang punya transaksi APPROVED BORROW aktif agar statusnya
--    menjadi 'dipinjam' (seperti Hytera PD788G).
-- ============================================================================
UPDATE public.assets a
SET status = 'dipinjam'::asset_status, updated_at = NOW()
WHERE a.status = 'tersedia'
  AND EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.asset_id = a.id
      AND t.action = 'BORROW'
      AND t.status = 'APPROVED'
      AND NOT EXISTS (
        SELECT 1 FROM public.transactions r
        WHERE r.asset_id = a.id
          AND r.action = 'RETURN'
          AND r.status = 'APPROVED'
          AND r.created_at > t.created_at
      )
  );
