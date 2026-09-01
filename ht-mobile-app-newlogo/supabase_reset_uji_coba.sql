-- ============================================================================
-- RESET DATA UJI COBA: Hapus semua transaksi & reset status aset ke TERSEDIA
-- Jalankan script ini di Supabase SQL Editor
-- ============================================================================

-- 1. Hapus seluruh log state aset
DELETE FROM public.asset_state_logs;

-- 2. Hapus seluruh transaksi (PENDING, APPROVED, REJECTED)
DELETE FROM public.transactions;

-- 3. Reset seluruh aset ke status TERSEDIA
UPDATE public.assets SET status = 'tersedia'::asset_status, updated_at = NOW();

-- ============================================================================
-- Selesai! Semua aset kembali ke status TERSEDIA, siap uji coba dari awal.
-- ============================================================================
