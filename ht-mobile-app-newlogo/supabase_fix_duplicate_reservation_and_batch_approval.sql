-- ============================================================================
-- MIGRASI: PERBAIKAN DUPLIKAT "SIAP SCAN" & PERSETUJUAN BATCH
-- ============================================================================
-- Masalah yang diperbaiki:
-- 1. Admin approve satu pengajuan -> aset tetap 'tersedia' (memang disengaja,
--    menandakan "siap discan fisik"). Tapi karena status aset masih 'tersedia',
--    unit yang SAMA masih bisa diajukan lagi oleh petugas lain (baik lewat
--    peminjaman satuan maupun batch), karena pengecekan duplikat pengajuan
--    lama HANYA menolak jika ada transaksi PENDING lain, tidak menghitung
--    transaksi yang sudah APPROVED namun belum discan fisik. Akibatnya:
--    pengajuan "Menunggu" baru bisa tercipta untuk unit yang SUDAH disetujui,
--    sehingga di panel admin unit tsb tampak "siap discan" dua kali (satu
--    APPROVED, satu lagi masih PENDING/menunggu, keduanya untuk unit fisik
--    yang sama).
-- 2. `approve_batch_transaction` / `reject_batch_transaction` dipanggil dari
--    aplikasi tetapi TIDAK PERNAH ada di file migrasi manapun pada repo ini
--    (hanya ada di database production yang diubah langsung lewat SQL
--    Editor). Definisi ulang di bawah ini memastikan SEMUA transaksi dalam
--    satu batch ikut ter-approve/ter-reject sekaligus (bukan sebagian saja),
--    dan tetap menerapkan guard yang sama dengan alur satuan.
--
-- CARA MENJALANKAN: copy seluruh isi file ini ke Supabase Dashboard ->
-- SQL Editor -> Run. Aman dijalankan berkali-kali (idempotent).
-- ============================================================================

-- 0. Pastikan kolom-kolom pendukung batch & pembatalan otomatis sudah ada
--    (menjaga migrasi ini tetap aman dijalankan di database mana pun).
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS borrower_id UUID REFERENCES public.profiles(id);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS batch_id UUID;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS batch_code TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

-- 0.1 Pastikan constraint status mengizinkan 'CANCELLED' (dipakai oleh alur
--     auto-cancel duplikat) TANPA membuang nilai lama yang mungkin masih
--     dipakai baris historis (mis. 'ACTIVE'/'COMPLETED'). Cari & hapus
--     constraint check lama pada kolom status apa pun namanya, lalu buat
--     ulang dengan menggabungkan daftar lama + nilai baru.
DO $$
DECLARE
  con RECORD;
BEGIN
  FOR con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.transactions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.transactions DROP CONSTRAINT %I', con.conname);
  END LOOP;
END $$;

ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_status_check
  CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ACTIVE', 'COMPLETED'));

-- ============================================================================
-- 1. FUNGSI BANTU: get_reserved_asset_ids()
-- Mengembalikan asset_id yang SEDANG "aktif dipesan": ada pengajuan PENDING,
-- ATAU sudah APPROVED namun belum ada serah-terima RETURN sesudahnya (artinya
-- sudah disetujui tapi belum discan fisik / masih dipinjam). Dipakai baik
-- oleh RPC server (guard anti-duplikat) maupun oleh katalog di aplikasi agar
-- unit yang sudah "siap scan" tidak ditawarkan lagi untuk diajukan ulang.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_reserved_asset_ids()
RETURNS TABLE(asset_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
  SELECT DISTINCT t.asset_id
  FROM public.transactions t
  WHERE t.action = 'BORROW'
    AND t.cancelled_at IS NULL
    AND (
      t.status = 'PENDING'
      OR (
        t.status = 'APPROVED'
        AND NOT EXISTS (
          SELECT 1 FROM public.transactions r
          WHERE r.asset_id = t.asset_id
            AND r.action = 'RETURN'
            AND r.status = 'APPROVED'
            AND r.cancelled_at IS NULL
            AND r.created_at > t.created_at
        )
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_reserved_asset_ids() TO authenticated, anon, service_role;

-- ============================================================================
-- 2. Perkuat process_asset_transaction: tolak pengajuan baru jika unit sudah
--    "dipesan" (PENDING atau APPROVED-belum-discan), bukan hanya PENDING.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.process_asset_transaction(
  p_asset_id UUID,
  p_action TEXT,
  p_condition TEXT DEFAULT 'baik',
  p_notes TEXT DEFAULT NULL,
  p_borrower_name TEXT DEFAULT NULL,
  p_borrower_nrp TEXT DEFAULT NULL,
  p_kesatuan TEXT DEFAULT NULL,
  p_due_date TIMESTAMPTZ DEFAULT NULL,
  p_document_url TEXT DEFAULT NULL,
  p_document_name TEXT DEFAULT NULL
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

    IF EXISTS (SELECT 1 FROM public.get_reserved_asset_ids() r WHERE r.asset_id = p_asset_id) THEN
      RAISE EXCEPTION 'Unit HT ini sudah memiliki pengajuan peminjaman aktif (menunggu persetujuan atau sudah disetujui & menunggu diambil). Harap pilih unit lain.';
    END IF;

    INSERT INTO public.transactions (
      asset_id, borrower_id, borrower_name, borrower_nrp, kesatuan,
      action, status, notes, due_date, document_url, document_name, created_at, updated_at
    )
    VALUES (
      p_asset_id, v_actual_borrower_id, v_b_name, v_b_nrp, v_b_kesatuan,
      'BORROW', 'PENDING', p_notes, p_due_date, p_document_url, p_document_name, v_now, v_now
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

-- ============================================================================
-- 3. Perkuat process_batch_asset_transaction dengan guard anti-duplikat yang
--    SAMA (sebelumnya HANYA mengecek status fisik aset, tidak mengecek
--    pengajuan lain yang masih aktif -- ini akar masalah duplikasi batch).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.process_batch_asset_transaction(
  p_asset_ids UUID[],
  p_action TEXT DEFAULT 'BORROW',
  p_borrower_name TEXT DEFAULT NULL,
  p_borrower_nrp TEXT DEFAULT NULL,
  p_kesatuan TEXT DEFAULT NULL,
  p_condition TEXT DEFAULT 'baik',
  p_notes TEXT DEFAULT NULL,
  p_due_date TIMESTAMPTZ DEFAULT NULL,
  p_document_url TEXT DEFAULT NULL,
  p_document_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_batch_id UUID := gen_random_uuid();
  v_batch_code TEXT;
  v_asset_id UUID;
  v_now TIMESTAMPTZ := NOW();
  v_created_tx_ids UUID[] := ARRAY[]::UUID[];
  v_tx_id UUID;
  v_b_name TEXT;
  v_b_nrp TEXT;
  v_b_kesatuan TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Akses ditolak: Pengguna belum terotentikasi.';
  END IF;

  IF array_length(p_asset_ids, 1) IS NULL OR array_length(p_asset_ids, 1) < 2 THEN
    RAISE EXCEPTION 'Peminjaman batch minimal membutuhkan 2 unit aset.';
  END IF;

  SELECT full_name, nrp, kesatuan
  INTO v_b_name, v_b_nrp, v_b_kesatuan
  FROM public.profiles WHERE id = v_user_id;

  v_b_name := COALESCE(NULLIF(TRIM(p_borrower_name), ''), v_b_name, 'Petugas');
  v_b_nrp := COALESCE(NULLIF(TRIM(p_borrower_nrp), ''), v_b_nrp, '-');
  v_b_kesatuan := COALESCE(NULLIF(TRIM(p_kesatuan), ''), v_b_kesatuan, '-');

  v_batch_code := 'BATCH-' || UPPER(SUBSTRING(REPLACE(v_batch_id::text, '-', ''), 1, 8));

  -- Kunci baris aset yang terlibat agar tidak ada race condition antar batch
  PERFORM 1 FROM public.assets WHERE id = ANY(p_asset_ids) FOR UPDATE;

  FOREACH v_asset_id IN ARRAY p_asset_ids LOOP
    -- Validasi status fisik unit
    IF EXISTS (
      SELECT 1 FROM public.assets
      WHERE id = v_asset_id AND (status = 'dipinjam' OR status = 'rusak')
    ) THEN
      RAISE EXCEPTION 'Salah satu unit aset tidak tersedia atau sedang dipinjam.';
    END IF;

    -- Validasi tidak ada pengajuan lain yang masih aktif untuk unit ini
    IF EXISTS (SELECT 1 FROM public.get_reserved_asset_ids() r WHERE r.asset_id = v_asset_id) THEN
      RAISE EXCEPTION 'Salah satu unit HT dalam batch ini sudah memiliki pengajuan peminjaman aktif (menunggu persetujuan atau sudah disetujui & menunggu diambil).';
    END IF;

    INSERT INTO public.transactions (
      asset_id, borrower_id, borrower_name, borrower_nrp, kesatuan,
      action, status, condition, notes, batch_id, batch_code,
      due_date, document_url, document_name, created_at, updated_at
    )
    VALUES (
      v_asset_id, v_user_id, v_b_name, v_b_nrp, v_b_kesatuan,
      'BORROW', 'PENDING', p_condition, p_notes, v_batch_id, v_batch_code,
      p_due_date, p_document_url, p_document_name, v_now, v_now
    )
    RETURNING id INTO v_tx_id;

    v_created_tx_ids := array_append(v_created_tx_ids, v_tx_id);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', v_batch_id,
    'batch_code', v_batch_code,
    'count', array_length(v_created_tx_ids, 1),
    'transaction_ids', v_created_tx_ids,
    'message', 'Pengajuan peminjaman batch berhasil dibuat.'
  );
END;
$$;

-- ============================================================================
-- 4. approve_batch_transaction: SEBELUMNYA TIDAK PERNAH ada di repo ini (hanya
--    di database production). Ditulis ulang agar men-SETUJUI SELURUH baris
--    transaksi dalam satu batch sekaligus (bukan sebagian), dengan guard yang
--    sama seperti approve_borrow_request, dan otomatis membatalkan pengajuan
--    PENDING duplikat lain untuk unit-unit yang sama.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.approve_batch_transaction(
  p_batch_id UUID,
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
  v_count INT;
  v_asset_ids UUID[];
BEGIN
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'ID Batch wajib diisi.';
  END IF;

  -- Kunci baris batch ini agar tidak diproses ganda secara bersamaan
  PERFORM 1 FROM public.transactions
  WHERE batch_id = p_batch_id AND action = 'BORROW' AND status = 'PENDING' AND cancelled_at IS NULL
  FOR UPDATE;

  SELECT COUNT(*), ARRAY_AGG(DISTINCT asset_id)
  INTO v_count, v_asset_ids
  FROM public.transactions
  WHERE batch_id = p_batch_id AND action = 'BORROW' AND status = 'PENDING' AND cancelled_at IS NULL;

  IF v_count IS NULL OR v_count = 0 THEN
    RAISE EXCEPTION 'Tidak ada pengajuan PENDING pada batch ini (mungkin sudah diproses sebelumnya).';
  END IF;

  -- Guard: pastikan tidak ada unit dalam batch ini yang sedang dipesan oleh
  -- transaksi AKTIF lain di luar batch ini (mencegah duplikat "siap scan").
  IF EXISTS (
    SELECT 1 FROM public.transactions t2
    WHERE t2.asset_id = ANY(v_asset_ids)
      AND t2.batch_id IS DISTINCT FROM p_batch_id
      AND t2.action = 'BORROW'
      AND t2.status = 'APPROVED'
      AND t2.cancelled_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.transactions r
        WHERE r.asset_id = t2.asset_id
          AND r.action = 'RETURN'
          AND r.status = 'APPROVED'
          AND r.cancelled_at IS NULL
          AND r.created_at > t2.created_at
      )
  ) THEN
    RAISE EXCEPTION 'Salah satu unit HT dalam batch ini sudah disetujui pada permohonan lain. Batalkan/tolak salah satu pengajuan terlebih dahulu.';
  END IF;

  -- 1. Setujui SELURUH baris pending pada batch ini sekaligus
  UPDATE public.transactions
  SET status = 'APPROVED', reviewed_by = v_admin_id, reviewed_at = v_now, updated_at = v_now
  WHERE batch_id = p_batch_id AND action = 'BORROW' AND status = 'PENDING' AND cancelled_at IS NULL;

  -- 2. Pastikan semua aset dalam batch tetap 'tersedia' (siap scan fisik)
  UPDATE public.assets
  SET status = 'tersedia'::asset_status, updated_at = v_now
  WHERE id = ANY(v_asset_ids);

  BEGIN
    INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
    SELECT a_id, 'tersedia'::asset_status, 'tersedia'::asset_status, v_admin_id,
      'Peminjaman batch disetujui admin (siap scan fisik)'
    FROM UNNEST(v_asset_ids) AS a_id;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- 3. Auto-cancel pengajuan PENDING duplikat lain untuk unit-unit ini
  UPDATE public.transactions
  SET
    status = 'CANCELLED',
    cancelled_at = v_now,
    cancel_reason = 'Otomatis dibatalkan: Pengajuan batch lain untuk unit ini telah disetujui.',
    updated_at = v_now
  WHERE asset_id = ANY(v_asset_ids)
    AND action = 'BORROW'
    AND status = 'PENDING'
    AND batch_id IS DISTINCT FROM p_batch_id
    AND cancelled_at IS NULL;

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'approved_count', v_count,
    'status', 'APPROVED',
    'message', 'Seluruh pengajuan batch berhasil disetujui. Unit kini siap scan fisik.'
  );
END;
$$;

-- ============================================================================
-- 5. reject_batch_transaction: menolak SELURUH baris pending pada satu batch.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.reject_batch_transaction(
  p_batch_id UUID,
  p_reason TEXT DEFAULT 'Ditolak oleh admin',
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
  v_count INT;
BEGIN
  IF p_batch_id IS NULL THEN
    RAISE EXCEPTION 'ID Batch wajib diisi.';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.transactions
  WHERE batch_id = p_batch_id AND action = 'BORROW' AND status = 'PENDING' AND cancelled_at IS NULL;

  IF v_count IS NULL OR v_count = 0 THEN
    RAISE EXCEPTION 'Tidak ada pengajuan PENDING pada batch ini untuk ditolak.';
  END IF;

  UPDATE public.transactions
  SET status = 'REJECTED', reviewed_by = v_admin_id, reviewed_at = v_now,
      rejection_reason = COALESCE(p_reason, 'Ditolak oleh admin'), updated_at = v_now
  WHERE batch_id = p_batch_id AND action = 'BORROW' AND status = 'PENDING' AND cancelled_at IS NULL;

  RETURN jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'rejected_count', v_count,
    'status', 'REJECTED',
    'message', 'Seluruh pengajuan batch berhasil ditolak.'
  );
END;
$$;

-- Izin Eksekusi RPC
GRANT EXECUTE ON FUNCTION public.process_asset_transaction(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.process_batch_asset_transaction(UUID[], TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.approve_batch_transaction(UUID, UUID) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.reject_batch_transaction(UUID, TEXT, UUID) TO authenticated, anon, service_role;
