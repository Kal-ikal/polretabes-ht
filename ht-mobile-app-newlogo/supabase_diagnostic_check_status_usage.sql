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
