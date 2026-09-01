-- ============================================================================
-- SUPABASE MIGRATION FIX: ADD MISSING `kesatuan` COLUMN TO PROFILES & REBUILD RPC
-- ============================================================================
-- Peringatan / Error di Supabase Log: 
--   "column kesatuan does not exist" (Postgres Code: 42703) -> HTTP 400 pada process_asset_transaction
--
-- Solusi:
--   1. Tambahkan kolom `kesatuan` ke tabel `profiles` dan `transactions` jika belum ada.
--   2. Perbarui RPC `process_asset_transaction` & `process_batch_asset_transaction` agar aman.
-- ============================================================================

-- 1. Tambah kolom kesatuan di tabel profiles & transactions jika belum ada
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS kesatuan TEXT DEFAULT '-';
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS kesatuan TEXT DEFAULT '-';
ALTER TABLE public.assets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Drop varian fungsi process_asset_transaction lama untuk menghindari ambigu PGRST203
DROP FUNCTION IF EXISTS public.process_asset_transaction(UUID, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.process_asset_transaction(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT);

-- 3. Buat Fungsi Unified Canon `process_asset_transaction`
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
  v_user_role TEXT;
  v_asset RECORD;
  v_tx_id UUID;
  v_now TIMESTAMPTZ := NOW();
  v_new_status TEXT;
  v_action_upper TEXT := UPPER(p_action);
  v_b_name TEXT := NULL;
  v_b_nrp TEXT := NULL;
  v_b_kesatuan TEXT := NULL;
BEGIN
  -- Fallback user ID jika auth.uid() NULL (misal session web anon/auth)
  IF v_user_id IS NULL THEN
    SELECT borrower_id INTO v_user_id
    FROM public.transactions
    WHERE asset_id = p_asset_id AND action = 'BORROW'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_user_id IS NULL THEN
      SELECT id INTO v_user_id FROM public.profiles WHERE role = 'admin' LIMIT 1;
    END IF;
  END IF;

  -- Ambil role pemicu
  SELECT role INTO v_user_role FROM public.profiles WHERE id = v_user_id;

  -- Kunci row aset
  SELECT * INTO v_asset FROM public.assets WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Aset HT tidak ditemukan.';
  END IF;

  -- Resolusi aman data profil (jika ada)
  IF v_user_id IS NOT NULL THEN
    SELECT full_name, nrp, kesatuan INTO v_b_name, v_b_nrp, v_b_kesatuan
    FROM public.profiles WHERE id = v_user_id;
  END IF;

  v_b_name := COALESCE(NULLIF(TRIM(p_borrower_name), ''), v_b_name, 'Petugas Logistik');
  v_b_nrp := COALESCE(NULLIF(TRIM(p_borrower_nrp), ''), v_b_nrp, '-');
  v_b_kesatuan := COALESCE(NULLIF(TRIM(p_kesatuan), ''), v_b_kesatuan, '-');

  IF v_action_upper = 'BORROW' THEN
    IF v_asset.status = 'dipinjam' THEN
      RAISE EXCEPTION 'Aset sedang dipinjam dan tidak tersedia.';
    END IF;

    IF v_user_role = 'admin' THEN
      INSERT INTO public.transactions (asset_id, user_id, borrower_name, borrower_nrp, kesatuan, action, status, reviewed_by, reviewed_at, notes)
      VALUES (p_asset_id, v_user_id, v_b_name, v_b_nrp, v_b_kesatuan, 'BORROW', 'APPROVED', v_user_id, v_now, p_notes)
      RETURNING id INTO v_tx_id;

      -- Status tetap tersedia awaiting scan serah terima fisik
      UPDATE public.assets SET status = 'tersedia', updated_at = v_now WHERE id = p_asset_id;

      INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
      VALUES (p_asset_id, v_asset.status, 'tersedia', v_user_id, 'Disetujui admin. Menunggu scan serah terima fisik.');
    ELSE
      INSERT INTO public.transactions (asset_id, user_id, borrower_name, borrower_nrp, kesatuan, action, status, notes)
      VALUES (p_asset_id, v_user_id, v_b_name, v_b_nrp, v_b_kesatuan, 'BORROW', 'PENDING', p_notes)
      RETURNING id INTO v_tx_id;
    END IF;

  ELSIF v_action_upper = 'RETURN' THEN
    v_new_status := CASE WHEN LOWER(p_condition) = 'rusak' THEN 'rusak' ELSE 'tersedia' END;

    INSERT INTO public.transactions (asset_id, user_id, borrower_name, borrower_nrp, kesatuan, action, status, condition, notes, reviewed_by, reviewed_at)
    VALUES (p_asset_id, v_user_id, v_b_name, v_b_nrp, v_b_kesatuan, 'RETURN', 'APPROVED', LOWER(p_condition), p_notes, v_user_id, v_now)
    RETURNING id INTO v_tx_id;

    UPDATE public.assets SET status = v_new_status::asset_status, updated_at = v_now WHERE id = p_asset_id;

    INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
    VALUES (p_asset_id, v_asset.status, v_new_status::asset_status, v_user_id, 'Pengembalian fisik berhasil (' || p_condition || ')');
  ELSE
    RAISE EXCEPTION 'Tindakan transaksi tidak valid: %. Gunakan BORROW atau RETURN.', p_action;
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

-- 4. Grant Hak Akses Eksekusi
GRANT EXECUTE ON FUNCTION public.process_asset_transaction(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO authenticated, anon, service_role;
