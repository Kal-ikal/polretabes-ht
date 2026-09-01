-- ============================================================================
-- SUPABASE MIGRATION: RPC APPROVAL & SCAN-TO-BORROW (NO CLIENT-SIDE DIRECT UPDATE)
-- ============================================================================
-- 1. approve_borrow_request(p_tx_id, p_admin_id) -> Approve borrow request
-- 2. scan_to_borrow(p_scanned_qr, p_tx_id, p_user_id) -> QR scan handover
-- ============================================================================

-- A. DROP FUNGSI LAMA AGAR BERSIH & TIDAK ADA AMBIGUITAS OVERLOAD
DROP FUNCTION IF EXISTS public.approve_borrow_request(UUID, UUID);
DROP FUNCTION IF EXISTS public.approve_borrow_request(UUID);
DROP FUNCTION IF EXISTS public.scan_to_borrow(TEXT, UUID, UUID);
DROP FUNCTION IF EXISTS public.scan_to_borrow(TEXT);
DROP FUNCTION IF EXISTS public.process_asset_transaction(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.confirm_physical_handover(UUID);
DROP FUNCTION IF EXISTS public.approve_transaction(UUID);

-- ============================================================================
-- 1. FUNGSI: approve_borrow_request (Tombol "Setujui" Admin)
-- Mengubah transaksi ke APPROVED, status aset tetap 'tersedia' (siap scan fisik)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.approve_borrow_request(
  p_tx_id UUID,
  p_admin_id UUID DEFAULT auth.uid()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_admin_id UUID := COALESCE(p_admin_id, auth.uid());
  v_now TIMESTAMPTZ := NOW();
  v_tx RECORD;
BEGIN
  IF p_tx_id IS NULL THEN
    RAISE EXCEPTION 'ID Transaksi wajib diisi.';
  END IF;

  SELECT * INTO v_tx FROM public.transactions WHERE id = p_tx_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transaksi peminjaman tidak ditemukan.';
  END IF;

  IF v_tx.status = 'APPROVED' THEN
    RAISE EXCEPTION 'Pengajuan peminjaman ini sudah disetujui sebelumnya.';
  END IF;
  IF v_tx.status = 'CANCELLED' OR v_tx.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Transaksi ini sudah dibatalkan dan tidak dapat disetujui.';
  END IF;
  IF v_tx.status = 'REJECTED' THEN
    RAISE EXCEPTION 'Transaksi ini sudah ditolak sebelumnya.';
  END IF;

  -- Validasi apakah aset sedang aktif dipinjam oleh permohonan lain
  IF EXISTS (
    SELECT 1 FROM public.transactions t2
    WHERE t2.asset_id = v_tx.asset_id
      AND t2.action = 'BORROW'
      AND t2.status = 'APPROVED'
      AND t2.cancelled_at IS NULL
      AND t2.id != p_tx_id
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

  -- 1. Update status transaksi menjadi APPROVED
  UPDATE public.transactions
  SET 
    status = 'APPROVED', 
    reviewed_by = v_admin_id, 
    reviewed_at = v_now, 
    updated_at = v_now
  WHERE id = p_tx_id;

  -- 2. Pastikan status aset tetap 'tersedia' (siap scan fisik)
  UPDATE public.assets
  SET status = 'tersedia'::asset_status, updated_at = v_now
  WHERE id = v_tx.asset_id;

  -- 3. Catat ke log state FSM
  BEGIN
    INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
    VALUES (v_tx.asset_id, 'tersedia'::asset_status, 'tersedia'::asset_status, v_admin_id,
      'Peminjaman disetujui admin (siap scan fisik oleh ' || COALESCE(v_tx.borrower_name, 'Petugas') || ')');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- 4. Auto-cancel pengajuan PENDING duplikat lain untuk unit ini
  UPDATE public.transactions
  SET
    status = 'CANCELLED',
    cancelled_at = v_now,
    cancel_reason = 'Otomatis dibatalkan: Pengajuan lain untuk unit ini telah disetujui.',
    updated_at = v_now
  WHERE asset_id = v_tx.asset_id
    AND action = 'BORROW'
    AND status = 'PENDING'
    AND id != p_tx_id
    AND cancelled_at IS NULL;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', p_tx_id,
    'status', 'APPROVED',
    'message', 'Pengajuan peminjaman berhasil disetujui. Unit kini siap scan fisik.'
  );
END;
$$;

-- Alias approve_transaction untuk backward compatibility
CREATE OR REPLACE FUNCTION public.approve_transaction(p_transaction_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
  RETURN public.approve_borrow_request(p_transaction_id, auth.uid());
END;
$$;

-- ============================================================================
-- 2. FUNGSI: scan_to_borrow (Fungsi Scan QR Petugas/Peminjam)
-- Memvalidasi kecocokan QR dan mengubah status aset ke 'dipinjam' secara aman
-- ============================================================================
CREATE OR REPLACE FUNCTION public.scan_to_borrow(
  p_scanned_qr TEXT,
  p_tx_id UUID DEFAULT NULL,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id UUID := COALESCE(p_user_id, auth.uid());
  v_now TIMESTAMPTZ := NOW();
  v_asset RECORD;
  v_tx RECORD;
  v_qr_clean TEXT := TRIM(p_scanned_qr);
  v_borrower_name TEXT;
BEGIN
  IF v_qr_clean IS NULL OR v_qr_clean = '' THEN
    RAISE EXCEPTION 'QR Code tidak boleh kosong.';
  END IF;

  -- 1. Cari data aset berdasarkan QR code atau ID aset
  SELECT * INTO v_asset 
  FROM public.assets 
  WHERE code = v_qr_clean 
     OR id::text = v_qr_clean 
     OR code ILIKE v_qr_clean 
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'QR Code tidak valid. Unit HT dengan kode "%" tidak ditemukan di database aset.', v_qr_clean;
  END IF;

  -- 2. Validasi transaksi peminjaman terkait
  IF p_tx_id IS NOT NULL THEN
    SELECT * INTO v_tx 
    FROM public.transactions 
    WHERE id = p_tx_id FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Transaksi peminjaman tidak ditemukan.';
    END IF;

    IF v_tx.asset_id != v_asset.id THEN
      RAISE EXCEPTION 'QR Code tidak valid. Pastikan aset yang di-scan sesuai dengan pengajuan (Target ID: %, Di-scan: %).', v_tx.asset_id, v_asset.code;
    END IF;
  ELSE
    -- Cari transaksi APPROVED BORROW aktif terbaru untuk aset ini
    SELECT * INTO v_tx 
    FROM public.transactions 
    WHERE asset_id = v_asset.id 
      AND action = 'BORROW' 
      AND status = 'APPROVED'
      AND cancelled_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.transactions r
        WHERE r.asset_id = v_asset.id
          AND r.action = 'RETURN'
          AND r.status = 'APPROVED'
          AND r.cancelled_at IS NULL
          AND r.created_at > public.transactions.created_at
      )
    ORDER BY created_at DESC 
    LIMIT 1 
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'QR Code tidak valid. Belum ada permohonan peminjaman yang disetujui (APPROVED) untuk unit HT "%". Silakan minta persetujuan admin terlebih dahulu.', v_asset.name;
    END IF;
  END IF;

  -- 3. Validasi status transaksi
  IF v_tx.status != 'APPROVED' THEN
    IF v_tx.status = 'PENDING' THEN
      RAISE EXCEPTION 'Pengajuan untuk unit ini masih PENDING. Tunggu persetujuan admin terlebih dahulu sebelum serah terima.';
    ELSE
      RAISE EXCEPTION 'Status permohonan (%) tidak valid untuk serah terima fisik.', v_tx.status;
    END IF;
  END IF;

  v_borrower_name := COALESCE(v_tx.borrower_name, 'Petugas');

  -- 4. Update status aset menjadi 'dipinjam'
  UPDATE public.assets
  SET status = 'dipinjam'::asset_status, updated_at = v_now
  WHERE id = v_asset.id;

  -- 5. Update updated_at transaksi
  UPDATE public.transactions
  SET updated_at = v_now
  WHERE id = v_tx.id;

  -- 6. Bersihkan pengajuan PENDING duplikat lain untuk unit ini
  UPDATE public.transactions
  SET
    status = 'CANCELLED',
    cancelled_at = v_now,
    cancel_reason = 'Otomatis dibatalkan: Serah terima fisik telah berhasil dilakukan.',
    updated_at = v_now
  WHERE asset_id = v_asset.id
    AND action = 'BORROW'
    AND status = 'PENDING'
    AND cancelled_at IS NULL;

  -- 7. Catat ke audit trail
  BEGIN
    INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
    VALUES (v_asset.id, 'tersedia'::asset_status, 'dipinjam'::asset_status, v_user_id,
      'Serah terima fisik via scan QR berhasil (' || v_borrower_name || ')');
  EXCEPTION WHEN OTHERS THEN NULL; END;

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', v_tx.id,
    'asset_id', v_asset.id,
    'asset_name', v_asset.name,
    'asset_code', v_asset.code,
    'status', 'dipinjam',
    'borrower_name', v_borrower_name,
    'message', 'Serah terima fisik berhasil! Status unit resmi beralih ke DIPINJAM.'
  );
END;
$$;

-- Alias confirm_physical_handover untuk backward compatibility
CREATE OR REPLACE FUNCTION public.confirm_physical_handover(p_asset_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_code TEXT;
BEGIN
  SELECT code INTO v_code FROM public.assets WHERE id = p_asset_id;
  RETURN public.scan_to_borrow(COALESCE(v_code, p_asset_id::text), NULL, auth.uid());
END;
$$;

-- ============================================================================
-- 3. FUNGSI: process_asset_transaction (Pengajuan Pinjam & Pengembalian)
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
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Akses ditolak: Pengguna belum terotentikasi. Silakan login terlebih dahulu.';
  END IF;

  SELECT role, full_name, nrp, kesatuan
  INTO v_user_role, v_b_name, v_b_nrp, v_b_kesatuan
  FROM public.profiles WHERE id = v_user_id;

  IF v_user_role IS NULL THEN
    v_user_role := 'petugas';
  END IF;

  SELECT * INTO v_asset FROM public.assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aset HT tidak ditemukan.';
  END IF;

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

  IF v_action_upper = 'BORROW' THEN
    IF (v_asset.status)::text = 'dipinjam' THEN
      RAISE EXCEPTION 'Aset sedang dipinjam dan tidak tersedia.';
    END IF;
    IF (v_asset.status)::text = 'rusak' THEN
      RAISE EXCEPTION 'Aset berstatus rusak dan tidak dapat dipinjam.';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.transactions
      WHERE asset_id = p_asset_id AND action = 'BORROW' AND status = 'PENDING'
        AND cancelled_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Sudah ada pengajuan peminjaman aktif untuk unit ini. Harap tunggu persetujuan admin.';
    END IF;

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

-- Izin Eksekusi RPC
GRANT EXECUTE ON FUNCTION public.approve_borrow_request(UUID, UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.scan_to_borrow(TEXT, UUID, UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.approve_transaction(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_physical_handover(UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.process_asset_transaction(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, anon, service_role;
