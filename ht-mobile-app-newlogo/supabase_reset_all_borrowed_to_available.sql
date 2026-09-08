-- ============================================================================
-- RESET: kembalikan SEMUA unit HT yang sedang 'dipinjam' menjadi 'tersedia'
-- ============================================================================
-- Dipakai untuk membersihkan data testing (unit yang "dipinjam" oleh
-- berbagai akun uji coba) sebelum pemakaian sungguhan. Setiap unit yang
-- di-reset akan otomatis mendapat baris transaksi RETURN resmi + log FSM,
-- supaya Riwayat/Audit tetap konsisten (bukan cuma status aset yang
-- diubah paksa tanpa jejak).
--
-- CATATAN: hanya menyentuh unit yang statusnya SAAT INI 'dipinjam'. Unit
-- yang PENDING/APPROVED (belum discan fisik) tidak disentuh oleh script
-- ini -- lihat bagian OPSIONAL di bawah kalau itu juga ingin dibersihkan.
--
-- CARA MENJALANKAN: copy ke Supabase SQL Editor -> Run.
-- ============================================================================

DO $$
DECLARE
  v_asset RECORD;
  v_count INT := 0;
BEGIN
  FOR v_asset IN SELECT id, name, code FROM public.assets WHERE status = 'dipinjam' LOOP
    UPDATE public.assets
    SET status = 'tersedia'::asset_status, updated_at = NOW()
    WHERE id = v_asset.id;

    INSERT INTO public.transactions (
      asset_id, action, status, condition, notes, reviewed_at, created_at, updated_at
    ) VALUES (
      v_asset.id, 'RETURN', 'APPROVED', 'baik',
      'Reset massal data testing oleh admin', NOW(), NOW(), NOW()
    );

    BEGIN
      INSERT INTO public.asset_state_logs (asset_id, from_state, to_state, reason)
      VALUES (v_asset.id, 'dipinjam'::asset_status, 'tersedia'::asset_status, 'Reset massal data testing oleh admin');
    EXCEPTION WHEN OTHERS THEN NULL; END;

    v_count := v_count + 1;
    RAISE NOTICE 'Reset unit % (%) ke tersedia', v_asset.name, v_asset.code;
  END LOOP;

  RAISE NOTICE 'Total % unit HT berhasil di-reset ke tersedia.', v_count;
END $$;

-- ============================================================================
-- OPSIONAL: batalkan juga semua pengajuan PENDING/APPROVED yang belum
-- discan fisik (kalau kamu juga mau bersihkan antrian "Menunggu" /
-- "Siap Scan" dari data testing). Jalankan terpisah, HANYA kalau memang
-- diinginkan -- ini membatalkan pengajuan yang mungkin masih ingin diuji.
-- ============================================================================
-- UPDATE public.transactions
-- SET status = 'CANCELLED', cancelled_at = NOW(),
--     cancel_reason = 'Dibatalkan: reset massal data testing oleh admin', updated_at = NOW()
-- WHERE action = 'BORROW' AND status = 'PENDING' AND cancelled_at IS NULL;
