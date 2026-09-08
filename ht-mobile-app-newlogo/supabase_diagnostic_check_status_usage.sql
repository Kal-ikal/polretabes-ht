-- 1. Lihat semua kombinasi status+action yang benar-benar ada di data & jumlahnya
SELECT status, action, COUNT(*) AS jumlah
FROM public.transactions
GROUP BY status, action
ORDER BY status, action;

-- 2. Lihat definisi ASLI fungsi-fungsi yang sudah hidup di database (bukan tebakan),
--    supaya perbaikan berikutnya dicocokkan dengan yang benar-benar berjalan.
SELECT proname, pg_get_functiondef(oid) AS definition
FROM pg_proc
WHERE proname IN (
  'approve_batch_transaction',
  'reject_batch_transaction',
  'scan_to_borrow',
  'approve_borrow_request',
  'process_asset_transaction',
  'process_batch_asset_transaction'
)
AND pronamespace = 'public'::regnamespace;

-- 3. VERIFIKASI SETELAH menjalankan ulang
--    supabase_fix_duplicate_reservation_and_batch_approval.sql: pastikan
--    tiap fungsi ini HANYA punya SATU baris (satu overload). Lebih dari
--    satu baris untuk nama yang sama = masih ambigu = tombol terkait akan
--    gagal total.
SELECT proname, COUNT(*) AS jumlah_overload
FROM pg_proc
WHERE proname IN (
  'approve_batch_transaction',
  'reject_batch_transaction',
  'process_asset_transaction',
  'process_batch_asset_transaction',
  'get_reserved_asset_ids'
)
AND pronamespace = 'public'::regnamespace
GROUP BY proname
ORDER BY proname;

-- 4. Cek constraint status saat ini (harus mengizinkan semua nilai yang
--    dipakai data: PENDING, APPROVED, REJECTED, CANCELLED, ACTIVE, COMPLETED)
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.transactions'::regclass AND contype = 'c';
