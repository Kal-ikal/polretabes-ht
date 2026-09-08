-- ============================================================================
-- MIGRASI: BATAS WAKTU PEMINJAMAN, PRESET DURASI, & UPLOAD SURAT RESMI
-- ============================================================================

-- 1. Tambah kolom batas waktu dan dokumen ke tabel transactions
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS document_url TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS document_name TEXT;

-- 2. Buat tabel preset durasi peminjaman (bisa di-custom oleh Admin)
CREATE TABLE IF NOT EXISTS public.loan_duration_presets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  duration_hours INT NOT NULL CHECK (duration_hours > 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS untuk loan_duration_presets
ALTER TABLE public.loan_duration_presets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Semua user terotentikasi dapat membaca preset durasi"
    ON public.loan_duration_presets FOR SELECT
    TO authenticated, anon
    USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Admin dapat mengelola preset durasi"
    ON public.loan_duration_presets FOR ALL
    TO authenticated
    USING (
      EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Isi data awal default preset jika masih kosong
INSERT INTO public.loan_duration_presets (label, duration_hours, is_active, sort_order)
SELECT * FROM (VALUES
  ('12 Jam (Piket)', 12, true, 1),
  ('1 Hari (24 Jam)', 24, true, 2),
  ('3 Hari (Operasi / PAM)', 72, true, 3),
  ('7 Hari (Kegiatan Khusus)', 168, true, 4)
) AS v(label, duration_hours, is_active, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.loan_duration_presets LIMIT 1);

-- 3. Update fungsi process_asset_transaction dengan parameter due_date dan document_url
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

    IF EXISTS (
      SELECT 1 FROM public.transactions
      WHERE asset_id = p_asset_id AND action = 'BORROW' AND status = 'PENDING'
        AND cancelled_at IS NULL
    ) THEN
      RAISE EXCEPTION 'Sudah ada pengajuan peminjaman aktif untuk unit ini. Harap tunggu persetujuan admin.';
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

-- 4. Update fungsi process_batch_asset_transaction dengan parameter due_date dan document_url
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

  FOREACH v_asset_id IN ARRAY p_asset_ids LOOP
    -- Validasi status unit
    IF EXISTS (
      SELECT 1 FROM public.assets
      WHERE id = v_asset_id AND (status = 'dipinjam' OR status = 'rusak')
    ) THEN
      RAISE EXCEPTION 'Salah satu unit aset tidak tersedia atau sedang dipinjam.';
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

GRANT ALL ON TABLE public.loan_duration_presets TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.process_asset_transaction(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.process_batch_asset_transaction(UUID[], TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT, TEXT) TO authenticated, anon, service_role;
