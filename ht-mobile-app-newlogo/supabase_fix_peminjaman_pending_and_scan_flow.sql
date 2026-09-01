-- ============================================================================
-- SUPABASE MIGRATION: PERBAIKAN ALUR PEMINJAMAN HT SESUAI KONSEP
-- ============================================================================
-- KONSEP:
-- 1. Pengajuan Peminjaman -> Status Transaksi: PENDING, Status Aset: tetap 'tersedia'
-- 2. Admin Panel -> Admin klik "Setujui" -> Status Transaksi: APPROVED (Mode Siap Scan Fisik), Status Aset: 'tersedia'
-- 3. Petugas/Admin Scan QR Fisik HT -> RPC confirm_physical_handover -> Status Aset berubah ke 'dipinjam'
-- 4. Pengembalian HT -> Status Aset kembali ke 'tersedia' (atau 'rusak')
-- ============================================================================

-- A. DROP FUNGSI LAMA AGAR TIDAK ADA AMBIGUITAS OVERLOAD
DROP FUNCTION IF EXISTS public.process_asset_transaction(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.confirm_physical_handover(UUID);
DROP FUNCTION IF EXISTS public.approve_transaction(UUID);
DROP FUNCTION IF EXISTS public.cancel_transaction(UUID);

-- ============================================================================
-- 1. FUNGSI: process_asset_transaction
-- SELALU membuat transaksi BORROW dengan status PENDING
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
  -- 1. Autentikasi Pengguna
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Akses ditolak: Pengguna belum terotentikasi. Silakan login terlebih dahulu.';
  END IF;

  -- 2. Profil Pemohon
  SELECT role, full_name, nrp, kesatuan
  INTO v_user_role, v_b_name, v_b_nrp, v_b_kesatuan
  FROM public.profiles WHERE id = v_user_id;

  IF v_user_role IS NULL THEN
    v_user_role := 'petugas';
  END IF;

  -- 3. Lock Aset
  SELECT * INTO v_asset FROM public.assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aset HT tidak ditemukan.';
  END IF;

  -- 4. Resolusi Data Peminjam
  v_b_name := COALESCE(NULLIF(TRIM(p_borrower_name), ''), v_b_name, 'Petugas Logistik');
  v_b_nrp := COALESCE(NULLIF(TRIM(p_borrower_nrp), ''), v_b_nrp, '-');
  v_b_kesatuan := COALESCE(NULLIF(TRIM(p_kesatuan), ''), v_b_kesatuan, '-');

  v_actual_borrower_id := v_user_id;
  IF v_user_role = 'admin' AND TRIM(p_borrower_nrp) IS NOT NULL AND TRIM(p_borrower_nrp) != '' THEN
    SELECT id INTO v_actual_borrower_id
    FROM public.profiles
    WHERE nrp = TRIM(p_borrower_nrp)
    LIMIT 1;
    IF v_actual_borrower_id IS NULL THEN
      v_actual_borrower_id := v_user_id;
    END IF;
  END IF;

  -- =============================================
  -- AKSI: BORROW (Pengajuan Peminjaman HT)
  -- =============================================
  IF v_action_upper = 'BORROW' THEN
    IF (v_asset.status)::text = 'dipinjam' THEN
      RAISE EXCEPTION 'Aset sedang dipinjam dan tidak tersedia.';
    END IF;
    IF (v_asset.status)::text = 'rusak' THEN
      RAISE EXCEPTION 'Aset berstatus rusak dan tidak dapat dipinjam.';
    END IF;

    -- Cegah duplikasi pengajuan PENDING untuk unit yang sama
    IF EXISTS (
      SELECT 1 FROM public.transactions
      WHERE asset_id = p_asset_id AND action = 'BORROW' AND status = 'PENDING'
        AND cancelled_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Sudah ada pengajuan peminjaman aktif untuk unit ini. Harap tunggu persetujuan admin.';
    END IF;

    -- SEMUA PENGAJUAN (Petugas maupun Admin) MASUK SEBAGAI 'PENDING'
    -- Status unit aset TETAP 'tersedia' sampai serah terima fisik QR scan dilakukan
    INSERT INTO public.transactions (
      asset_id, borrower_id, borrower_name, borrower_nrp, kesatuan,
      action, status, notes, created_at, updated_at
    )
    VALUES (
      p_asset_id, v_actual_borrower_id, v_b_name, v_b_nrp, v_b_kesatuan,
      'BORROW', 'PENDING', p_notes, v_now, v_now
    )
    RETURNING id INTO v_tx_id;

    BEGIN
      INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
      VALUES (p_asset_id, (v_asset.status)::asset_status, (v_asset.status)::asset_status, v_user_id,
        'Pengajuan peminjaman baru oleh ' || v_b_name || ' (Menunggu Persetujuan Admin)');
    EXCEPTION WHEN OTHERS THEN NULL; END;

  -- =============================================
  -- AKSI: RETURN (Pengembalian HT)
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
    'status', CASE WHEN v_action_upper = 'RETURN' THEN 'APPROVED' ELSE 'PENDING' END
  );
END;
$$;

-- ============================================================================
-- 2. FUNGSI: approve_transaction
-- Admin menyetujui pengajuan -> Status Transaksi: APPROVED (Siap Scan Fisik)
-- Status Aset TETAP 'tersedia' (belum dipinjam sebelum fisik diserahkan)
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

  IF v_tx.status = 'APPROVED' THEN
    RAISE EXCEPTION 'Transaksi ini sudah disetujui sebelumnya.';
  END IF;
  IF v_tx.status = 'CANCELLED' OR v_tx.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Transaksi ini sudah dibatalkan dan tidak dapat disetujui.';
  END IF;

  -- Cek jika aset sedang dipinjam aktif oleh orang lain
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
      RAISE EXCEPTION 'Unit HT ini sedang dipinjam oleh permohonan lain. Pengajuan tidak dapat disetujui.';
    END IF;
  END IF;

  -- Setujui transaksi (Status menjadi APPROVED = Siap Scan Fisik)
  UPDATE public.transactions
  SET status = 'APPROVED', reviewed_by = v_admin_id, reviewed_at = v_now, updated_at = v_now
  WHERE id = p_transaction_id;

  IF v_tx.action = 'BORROW' THEN
    -- Status aset TETAP 'tersedia' (siap scan fisik)
    UPDATE public.assets
    SET status = 'tersedia'::asset_status, updated_at = v_now
    WHERE id = v_tx.asset_id;

    BEGIN
      INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
      VALUES (v_tx.asset_id, 'tersedia'::asset_status, 'tersedia'::asset_status, v_admin_id,
        'Peminjaman disetujui admin (siap scan fisik oleh ' || COALESCE(v_tx.borrower_name, 'Petugas') || ')');
    EXCEPTION WHEN OTHERS THEN NULL; END;

    -- Auto-cancel pengajuan PENDING duplikat lain untuk aset ini
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
-- 3. FUNGSI: confirm_physical_handover
-- Dipanggil saat Scan QR Fisik HT dilakukan -> Status Aset menjadi 'dipinjam'
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

  -- Cari transaksi APPROVED BORROW aktif yang belum ditutup oleh RETURN
  SELECT * INTO v_tx
  FROM public.transactions
  WHERE asset_id = p_asset_id AND action = 'BORROW' AND status = 'APPROVED'
    AND cancelled_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.transactions r
      WHERE r.asset_id = p_asset_id
        AND r.action = 'RETURN'
        AND r.status = 'APPROVED'
        AND r.cancelled_at IS NULL
        AND r.created_at > public.transactions.created_at
    )
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tidak ada permohonan peminjaman yang telah disetujui (APPROVED) untuk unit HT ini.';
  END IF;

  v_borrower_name := COALESCE(v_tx.borrower_name, 'Petugas');

  -- Update status aset menjadi 'dipinjam'
  UPDATE public.assets
  SET status = 'dipinjam'::asset_status, updated_at = v_now
  WHERE id = p_asset_id;

  IF v_tx.id IS NOT NULL THEN
    UPDATE public.transactions
    SET updated_at = v_now
    WHERE id = v_tx.id;
  END IF;

  -- Bersihkan permohonan PENDING lain
  UPDATE public.transactions
  SET
    status = 'CANCELLED',
    cancelled_at = v_now,
    cancel_reason = 'Otomatis dibatalkan: Serah terima fisik unit telah dilakukan.',
    updated_at = v_now
  WHERE asset_id = p_asset_id
    AND action = 'BORROW'
    AND status = 'PENDING'
    AND cancelled_at IS NULL;

  BEGIN
    INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
    VALUES (p_asset_id, 'tersedia'::asset_status, 'dipinjam'::asset_status, v_user_id,
      'Serah terima fisik via scan QR berhasil (' || v_borrower_name || ')');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object(
    'success', true,
    'asset_id', p_asset_id,
    'status', 'dipinjam',
    'borrower_name', v_borrower_name
  );
END;
$$;

-- Grant Execution Permissions
GRANT EXECUTE ON FUNCTION public.process_asset_transaction(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.approve_transaction(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_physical_handover(UUID) TO authenticated, anon, service_role;
