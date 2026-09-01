-- ============================================================================
-- BULLETPROOF SCHEMA: PERBAIKAN 7 LOGICAL FALLACY
-- ============================================================================
-- Jalankan script ini di Supabase SQL Editor SETELAH supabase_fix_all_rpc_and_columns.sql
-- Script ini AMAN dijalankan berulang kali (idempotent).
--
-- PERBAIKAN:
--   1. Hapus fallback anonim -> admin (Security)
--   2. Lookup borrower_id berdasarkan NRP (Identity)
--   3. Soft-delete transaksi (Audit Trail)
--   4. Validasi status sebelum RETURN (State Consistency)
--   5. Cegah persetujuan ganda pada aset yang sama (Race Condition)
--   6. cancel_transaction cerdas: cek kondisi fisik terakhir (State Consistency)
--   7. RLS lebih ketat: UPDATE/DELETE hanya admin (Security)
-- ============================================================================

-- ============================================================================
-- BAGIAN A: STRUKTUR TABEL TAMBAHAN
-- ============================================================================

-- Tambah kolom cancelled_at untuk soft-delete
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS cancel_reason TEXT DEFAULT NULL;

-- ============================================================================
-- BAGIAN B: RLS POLICIES LEBIH KETAT
-- ============================================================================
-- Perbaikan #7: Batasi UPDATE/DELETE langsung hanya untuk admin

-- Drop policy lama & policy baru jika sudah ada (agar aman dijalankan berulang kali)
DROP POLICY IF EXISTS "transactions_update_authenticated" ON public.transactions;
DROP POLICY IF EXISTS "transactions_delete_authenticated" ON public.transactions;
DROP POLICY IF EXISTS "assets_update_authenticated" ON public.assets;

DROP POLICY IF EXISTS "transactions_update_admin_only" ON public.transactions;
DROP POLICY IF EXISTS "transactions_delete_admin_only" ON public.transactions;
DROP POLICY IF EXISTS "assets_update_admin_only" ON public.assets;

-- Policy baru: hanya admin bisa UPDATE/DELETE langsung via REST API
-- (Petugas tetap bisa via RPC SECURITY DEFINER)
CREATE POLICY "transactions_update_admin_only" ON public.transactions
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "transactions_delete_admin_only" ON public.transactions
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "assets_update_admin_only" ON public.assets
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================================================
-- BAGIAN C: DROP FUNGSI LAMA & BUAT ULANG YANG SUDAH DIPERBAIKI
-- ============================================================================

DROP FUNCTION IF EXISTS public.process_asset_transaction(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.confirm_physical_handover(UUID);
DROP FUNCTION IF EXISTS public.approve_transaction(UUID);
DROP FUNCTION IF EXISTS public.approve_batch_transaction(UUID);
DROP FUNCTION IF EXISTS public.cancel_transaction(UUID);

-- ============================================================================
-- FUNGSI 1: process_asset_transaction (BULLETPROOF)
-- ============================================================================
-- Perbaikan #1: Tolak akses anonim (tidak lagi fallback ke admin)
-- Perbaikan #2: Lookup borrower_id berdasarkan NRP jika admin input manual
-- Perbaikan #5 (partial): Cek RETURN hanya jika aset dipinjam
-- ============================================================================
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
  v_actual_borrower_id UUID;
BEGIN
  -- =============================================
  -- PERBAIKAN #1: Tolak user anonim / tanpa sesi
  -- =============================================
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Akses ditolak: Pengguna belum terotentikasi. Silakan login terlebih dahulu.';
  END IF;

  -- Ambil profil user yang sedang login
  SELECT role, full_name, nrp, kesatuan
  INTO v_user_role, v_b_name, v_b_nrp, v_b_kesatuan
  FROM public.profiles WHERE id = v_user_id;

  IF v_user_role IS NULL THEN
    v_user_role := 'petugas';
  END IF;

  -- Lock aset untuk mencegah race condition
  SELECT * INTO v_asset FROM public.assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aset HT tidak ditemukan.';
  END IF;

  -- Resolve nama, NRP, kesatuan peminjam
  v_b_name := COALESCE(NULLIF(TRIM(p_borrower_name), ''), v_b_name, 'Petugas Logistik');
  v_b_nrp := COALESCE(NULLIF(TRIM(p_borrower_nrp), ''), v_b_nrp, '-');
  v_b_kesatuan := COALESCE(NULLIF(TRIM(p_kesatuan), ''), v_b_kesatuan, '-');

  -- =============================================
  -- PERBAIKAN #2: Lookup borrower_id berdasarkan NRP
  -- =============================================
  v_actual_borrower_id := v_user_id; -- default: user yang login
  IF v_user_role = 'admin' AND TRIM(p_borrower_nrp) IS NOT NULL AND TRIM(p_borrower_nrp) != '' THEN
    SELECT id INTO v_actual_borrower_id
    FROM public.profiles
    WHERE nrp = TRIM(p_borrower_nrp)
    LIMIT 1;
    -- Jika NRP tidak ditemukan, tetap gunakan admin sebagai borrower_id
    IF v_actual_borrower_id IS NULL THEN
      v_actual_borrower_id := v_user_id;
    END IF;
  END IF;

  -- =============================================
  -- AKSI: BORROW (Peminjaman)
  -- =============================================
  IF v_action_upper = 'BORROW' THEN
    -- Cek apakah aset bisa dipinjam
    IF (v_asset.status)::text = 'dipinjam' THEN
      RAISE EXCEPTION 'Aset sedang dipinjam dan tidak tersedia.';
    END IF;
    IF (v_asset.status)::text = 'rusak' THEN
      RAISE EXCEPTION 'Aset berstatus rusak dan tidak dapat dipinjam.';
    END IF;

    -- Cek apakah sudah ada pengajuan PENDING untuk aset ini (cegah duplikasi)
    IF EXISTS (
      SELECT 1 FROM public.transactions
      WHERE asset_id = p_asset_id AND action = 'BORROW' AND status = 'PENDING'
        AND cancelled_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Sudah ada pengajuan peminjaman aktif untuk unit ini. Harap tunggu persetujuan admin.';
    END IF;

    -- ADMIN: Langsung APPROVED + status aset -> dipinjam
    IF v_user_role = 'admin' THEN
      INSERT INTO public.transactions (
        asset_id, borrower_id, borrower_name, borrower_nrp, kesatuan,
        action, status, reviewed_by, reviewed_at, notes, created_at, updated_at
      )
      VALUES (
        p_asset_id, v_actual_borrower_id, v_b_name, v_b_nrp, v_b_kesatuan,
        'BORROW', 'APPROVED', v_user_id, v_now, p_notes, v_now, v_now
      )
      RETURNING id INTO v_tx_id;

      UPDATE public.assets
      SET status = 'dipinjam'::asset_status, updated_at = v_now
      WHERE id = p_asset_id;

      BEGIN
        INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
        VALUES (p_asset_id, (v_asset.status)::asset_status, 'dipinjam'::asset_status, v_user_id,
          'Peminjaman langsung oleh admin (' || v_b_name || ')');
      EXCEPTION WHEN OTHERS THEN NULL; END;

    -- PETUGAS: PENDING (Menunggu persetujuan admin)
    ELSE
      INSERT INTO public.transactions (
        asset_id, borrower_id, borrower_name, borrower_nrp, kesatuan,
        action, status, notes, created_at, updated_at
      )
      VALUES (
        p_asset_id, v_actual_borrower_id, v_b_name, v_b_nrp, v_b_kesatuan,
        'BORROW', 'PENDING', p_notes, v_now, v_now
      )
      RETURNING id INTO v_tx_id;
    END IF;

  -- =============================================
  -- AKSI: RETURN (Pengembalian)
  -- Perbaikan #4: Validasi status harus 'dipinjam'
  -- =============================================
  ELSIF v_action_upper = 'RETURN' THEN
    IF (v_asset.status)::text != 'dipinjam' THEN
      RAISE EXCEPTION 'Aset ini tidak sedang dalam status dipinjam, tidak dapat dikembalikan.';
    END IF;

    v_new_status := CASE WHEN LOWER(p_condition) = 'rusak' THEN 'rusak' ELSE 'tersedia' END;

    INSERT INTO public.transactions (
      asset_id, borrower_id, borrower_name, borrower_nrp, kesatuan,
      action, status, condition, notes, reviewed_by, reviewed_at, created_at, updated_at
    )
    VALUES (
      p_asset_id, v_actual_borrower_id, v_b_name, v_b_nrp, v_b_kesatuan,
      'RETURN', 'APPROVED', LOWER(p_condition), p_notes, v_user_id, v_now, v_now, v_now
    )
    RETURNING id INTO v_tx_id;

    UPDATE public.assets
    SET status = v_new_status::asset_status, updated_at = v_now
    WHERE id = p_asset_id;

    BEGIN
      INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
      VALUES (p_asset_id, 'dipinjam'::asset_status, v_new_status::asset_status, v_user_id,
        'Pengembalian unit berhasil (' || p_condition || ')');
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

-- ============================================================================
-- FUNGSI 2: confirm_physical_handover (BULLETPROOF)
-- ============================================================================
-- Perbaikan #3: Soft-delete transaksi PENDING (bukan DELETE)
-- ============================================================================
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

  -- Cari transaksi APPROVED BORROW terbaru
  SELECT * INTO v_tx
  FROM public.transactions
  WHERE asset_id = p_asset_id AND action = 'BORROW' AND status = 'APPROVED'
    AND cancelled_at IS NULL
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

  -- =============================================
  -- PERBAIKAN #3: Soft-delete transaksi PENDING
  -- (bukan DELETE, agar riwayat tetap tercatat)
  -- =============================================
  UPDATE public.transactions
  SET
    status = 'CANCELLED',
    cancelled_at = v_now,
    cancel_reason = 'Otomatis dibatalkan: Serah terima fisik unit dilakukan untuk peminjam lain.',
    updated_at = v_now
  WHERE asset_id = p_asset_id
    AND action = 'BORROW'
    AND status = 'PENDING'
    AND cancelled_at IS NULL;

  BEGIN
    INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
    VALUES (p_asset_id, 'tersedia'::asset_status, 'dipinjam'::asset_status, v_user_id,
      'Serah terima fisik berhasil (' || v_borrower_name || ')');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object(
    'success', true,
    'asset_id', p_asset_id,
    'status', 'dipinjam',
    'borrower_name', v_borrower_name
  );
END;
$$;

-- ============================================================================
-- FUNGSI 3: approve_transaction (BULLETPROOF)
-- ============================================================================
-- Perbaikan #5: Cegah persetujuan ganda & auto-cancel pengajuan PENDING lain
-- ============================================================================
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

  -- Cek apakah transaksi sudah pernah diapprove/cancel
  IF v_tx.status = 'APPROVED' THEN
    RAISE EXCEPTION 'Transaksi ini sudah disetujui sebelumnya.';
  END IF;
  IF v_tx.status = 'CANCELLED' OR v_tx.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Transaksi ini sudah dibatalkan dan tidak dapat disetujui.';
  END IF;

  -- =============================================
  -- PERBAIKAN #5: Cek apakah aset sudah dipinjam
  -- oleh transaksi APPROVED lain (race condition)
  -- =============================================
  IF v_tx.action = 'BORROW' THEN
    IF EXISTS (
      SELECT 1 FROM public.transactions t2
      WHERE t2.asset_id = v_tx.asset_id
        AND t2.action = 'BORROW'
        AND t2.status = 'APPROVED'
        AND t2.cancelled_at IS NULL
        AND t2.id != p_transaction_id
        AND NOT EXISTS (
          SELECT 1 FROM public.transactions r
          WHERE r.asset_id = v_tx.asset_id
            AND r.action = 'RETURN'
            AND r.status = 'APPROVED'
            AND r.cancelled_at IS NULL
            AND r.created_at > t2.created_at
        )
    ) THEN
      RAISE EXCEPTION 'Unit HT ini sudah dipinjam oleh petugas lain. Pengajuan tidak dapat disetujui.';
    END IF;
  END IF;

  -- Setujui transaksi ini (Status transaksi menjadi APPROVED = Siap Scan Fisik)
  UPDATE public.transactions
  SET status = 'APPROVED', reviewed_by = v_admin_id, reviewed_at = v_now, updated_at = v_now
  WHERE id = p_transaction_id;

  IF v_tx.action = 'BORROW' THEN
    -- Status aset TIDAK langsung diubah ke 'dipinjam' di sini,
    -- status aset tetap 'tersedia' (siap scan) hingga petugas memindai fisik QR via confirm_physical_handover.
    BEGIN
      INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
      VALUES (v_tx.asset_id, 'tersedia'::asset_status, 'tersedia'::asset_status, v_admin_id,
        'Peminjaman disetujui admin (siap scan fisik oleh ' || COALESCE(v_tx.borrower_name, 'Petugas') || ')');
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- =============================================
    -- PERBAIKAN #5: Auto-cancel pengajuan PENDING
    -- lain untuk aset yang sama
    -- =============================================
    UPDATE public.transactions
    SET
      status = 'CANCELLED',
      cancelled_at = v_now,
      cancel_reason = 'Otomatis dibatalkan: Pengajuan lain untuk unit ini telah disetujui.',
      updated_at = v_now
    WHERE asset_id = v_tx.asset_id
      AND action = 'BORROW'
      AND status = 'PENDING'
      AND id != p_transaction_id
      AND cancelled_at IS NULL;

  ELSIF v_tx.action = 'RETURN' THEN
    v_target_state := CASE WHEN LOWER(COALESCE(v_tx.condition, 'baik')) = 'rusak' THEN 'rusak' ELSE 'tersedia' END;
    UPDATE public.assets SET status = v_target_state::asset_status, updated_at = v_now WHERE id = v_tx.asset_id;
    BEGIN
      INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
      VALUES (v_tx.asset_id, 'dipinjam'::asset_status, v_target_state::asset_status, v_admin_id,
        'Pengembalian disetujui admin');
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN jsonb_build_object('success', true, 'transaction_id', p_transaction_id, 'status', 'APPROVED');
END;
$$;

-- ============================================================================
-- FUNGSI 4: approve_batch_transaction (BULLETPROOF)
-- ============================================================================
-- Perbaikan #5: Auto-cancel pengajuan PENDING duplikat per aset
-- ============================================================================
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

  -- Approve semua transaksi PENDING dalam batch (Status menjadi APPROVED = Siap Scan Fisik)
  UPDATE public.transactions
  SET
    status = 'APPROVED',
    reviewed_by = v_admin_id,
    reviewed_at = v_now,
    updated_at = v_now
  WHERE batch_id = p_batch_id AND status = 'PENDING' AND cancelled_at IS NULL;

  GET DIAGNOSTICS v_approved_count = ROW_COUNT;

  -- Loop untuk log dan auto-cancel pengajuan ganda lainnya
  FOR v_tx IN
    SELECT * FROM public.transactions WHERE batch_id = p_batch_id AND status = 'APPROVED'
  LOOP
    IF v_tx.action = 'BORROW' THEN
      -- Status aset TETAP 'tersedia' (siap scan), TIDAK langsung 'dipinjam' sampai QR fisik discan
      BEGIN
        INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
        VALUES (v_tx.asset_id, 'tersedia'::asset_status, 'tersedia'::asset_status, v_admin_id,
          'Batch peminjaman disetujui - siap scan fisik (' || COALESCE(v_tx.batch_code, '') || ')');
      EXCEPTION WHEN OTHERS THEN NULL; END;

      -- Auto-cancel pengajuan PENDING lain untuk aset yang sama (di luar batch ini)
      UPDATE public.transactions
      SET
        status = 'CANCELLED',
        cancelled_at = v_now,
        cancel_reason = 'Otomatis dibatalkan: Batch peminjaman lain untuk unit ini telah disetujui.',
        updated_at = v_now
      WHERE asset_id = v_tx.asset_id
        AND action = 'BORROW'
        AND status = 'PENDING'
        AND (batch_id IS NULL OR batch_id != p_batch_id)
        AND cancelled_at IS NULL;

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

-- ============================================================================
-- FUNGSI 5: cancel_transaction (BULLETPROOF)
-- ============================================================================
-- Perbaikan #3: Soft-delete (update status, bukan DELETE)
-- Perbaikan #6: Cek kondisi fisik terakhir sebelum reset status
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancel_transaction(p_transaction_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_tx RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_restore_status TEXT := 'tersedia';
  v_has_other_active_borrow BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaksi tidak ditemukan.';
  END IF;

  -- Sudah dibatalkan sebelumnya?
  IF v_tx.status = 'CANCELLED' OR v_tx.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Transaksi ini sudah dibatalkan sebelumnya.';
  END IF;

  -- =============================================
  -- PERBAIKAN #3: Soft-delete (bukan DELETE)
  -- =============================================
  UPDATE public.transactions
  SET
    status = 'CANCELLED',
    cancelled_at = v_now,
    cancel_reason = 'Dibatalkan secara manual oleh admin.',
    updated_at = v_now
  WHERE id = p_transaction_id;

  -- =============================================
  -- PERBAIKAN #6: Cek kondisi fisik & peminjaman
  -- aktif lainnya sebelum reset status aset
  -- =============================================

  -- Cek apakah ada peminjaman APPROVED aktif lain untuk aset ini
  SELECT EXISTS (
    SELECT 1 FROM public.transactions t2
    WHERE t2.asset_id = v_tx.asset_id
      AND t2.action = 'BORROW'
      AND t2.status = 'APPROVED'
      AND t2.id != p_transaction_id
      AND t2.cancelled_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.transactions r
        WHERE r.asset_id = v_tx.asset_id
          AND r.action = 'RETURN'
          AND r.status = 'APPROVED'
          AND r.cancelled_at IS NULL
          AND r.created_at > t2.created_at
      )
  ) INTO v_has_other_active_borrow;

  -- Hanya reset status jika tidak ada peminjaman aktif lain
  IF NOT v_has_other_active_borrow THEN
    -- Cek apakah ada catatan kondisi rusak terakhir yang belum dibatalkan
    IF EXISTS (
      SELECT 1 FROM public.transactions
      WHERE asset_id = v_tx.asset_id
        AND action = 'RETURN'
        AND status = 'APPROVED'
        AND LOWER(COALESCE(condition, 'baik')) = 'rusak'
        AND cancelled_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    ) THEN
      v_restore_status := 'rusak';
    ELSE
      v_restore_status := 'tersedia';
    END IF;

    UPDATE public.assets
    SET status = v_restore_status::asset_status, updated_at = v_now
    WHERE id = v_tx.asset_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Transaksi berhasil dibatalkan.',
    'asset_status', v_restore_status
  );
END;
$$;

-- ============================================================================
-- BAGIAN D: BERIKAN HAK AKSES EKSEKUSI
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.process_asset_transaction(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_physical_handover(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.approve_transaction(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.approve_batch_transaction(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_transaction(UUID) TO authenticated, anon, service_role;

-- ============================================================================
-- BAGIAN E: NORMALISASI STATUS ASET YANG BELUM SCAN FISIK
-- ============================================================================
-- Mengembalikan status aset yang sudah di-approve tetapi belum di-scan fisik
-- agar status asetnya kembali 'tersedia' (siap scan).
-- ============================================================================
UPDATE public.assets a
SET status = 'tersedia'::asset_status, updated_at = NOW()
WHERE a.status = 'dipinjam'
  AND EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.asset_id = a.id
      AND t.action = 'BORROW'
      AND t.status = 'APPROVED'
      AND t.cancelled_at IS NULL
      -- Tidak ada log serah terima fisik
      AND NOT EXISTS (
        SELECT 1 FROM public.asset_state_logs l
        WHERE l.asset_id = a.id
          AND l.reason ILIKE '%Serah terima fisik berhasil%'
          AND l.created_at >= t.reviewed_at
      )
  );

