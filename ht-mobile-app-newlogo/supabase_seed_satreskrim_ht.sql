-- =====================================================================
-- SEED DATA: DATA PEMEGANG HT DINAS SAT RESKRIM POLRESTABES PALEMBANG TAHUN 2026
-- Jalankan script ini di Supabase SQL Editor (Dashboard -> SQL Editor -> New Query)
-- =====================================================================

-- 1. Insert/Update Data HT (assets)
INSERT INTO public.assets (code, name, serial_number, status, qr_code_url) VALUES
('HT-837TUB4812', 'Motorola Sat Reskrim', '837 TUB 4812', 'tersedia', 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=HT-837TUB4812'),
('HT-29152', 'Motorola Sat Reskrim', '837 TRZG 596', 'tersedia', 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=HT-29152'),
('HT-29154', 'Motorola Sat Reskrim', '837 TRZG 568', 'tersedia', 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=HT-29154'),
('HT-29156', 'Motorola Sat Reskrim', '837 TRZG 598', 'tersedia', 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=HT-29156'),
('HT-29157', 'Motorola Sat Reskrim', '837 TRZG 550', 'tersedia', 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=HT-29157'),
('HT-29158', 'Motorola Sat Reskrim', '837 TRZG 605', 'tersedia', 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=HT-29158'),
('HT-29159', 'Motorola Sat Reskrim', '837 TRZG 335', 'tersedia', 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=HT-29159'),
('HT-29428', 'Motorola Sat Reskrim', '837 TRZT 803', 'tersedia', 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=HT-29428'),
('HT-10700', 'Motorola Sat Reskrim', '837 TSRA 850', 'tersedia', 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=HT-10700'),
('HT-29242', 'Motorola Sat Reskrim', '837 TST 4445', 'tersedia', 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=HT-29242'),
('HT-29323', 'Motorola Sat Reskrim', '837 TST 2760', 'tersedia', 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=HT-29323'),
('HT-29324', 'Motorola Sat Reskrim', '837 TST 4468', 'tersedia', 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=HT-29324'),
('HT-29336', 'Motorola Sat Reskrim', '837 TST 0317', 'tersedia', 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=HT-29336'),
('HT-29338', 'Motorola Sat Reskrim', '837 TST 2314', 'tersedia', 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=HT-29338'),
('HT-10794', 'Motorola Sat Reskrim', '837 TST 4421', 'tersedia', 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=HT-10794'),
('HT-29322', 'Motorola Sat Reskrim', '837 TST 4416', 'tersedia', 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=HT-29322'),
('HT-29340', 'Motorola Sat Reskrim', '837 TST 2263', 'tersedia', 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=HT-29340'),
('HT-29145', 'Motorola Sat Reskrim (Carger Rusak)', '837 TRZG 543', 'rusak', 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=HT-29145'),
('HT-29155', 'Motorola Sat Reskrim (Carger Rusak)', '837 TRZG 583', 'rusak', 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=HT-29155'),
('HT-28067', 'Motorola Sat Reskrim (Rusak Berat)', '205 TNE 2667', 'rusak', 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=HT-28067'),
('HT-28073', 'Motorola Sat Reskrim (Rusak Berat)', '205 TNE 2645', 'rusak', 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=HT-28073'),
('HT-29066', 'Motorola Sat Reskrim (Rusak Berat)', '205 TNE 3586', 'rusak', 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=HT-29066'),
('HT-837TUB4747', 'Motorola Sat Reskrim', '837 TUB 4747', 'tersedia', 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=HT-837TUB4747')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  serial_number = EXCLUDED.serial_number,
  status = EXCLUDED.status,
  qr_code_url = EXCLUDED.qr_code_url;

-- 2. Insert/Update Data Roster Personel Kepolisian (personnel_roster)
INSERT INTO public.personnel_roster (nrp, name, is_registered) VALUES
('29152', 'BRIPKA ERIE SEPTEDI, SH', false),
('29154', 'IPTU KRISTIAN ANDI, SH, MH', false),
('29156', 'PIKET FUNGSI', false),
('29157', 'KOMPOL IWAN GUNAWAN, SH, MH', false),
('29158', 'IPTU JHONI PALAPA, SH, MH', false),
('29159', 'IPTU RISWANTO, SH', false),
('29428', 'IPTU HASYIM PRONOTO, SH', false),
('10700', 'IPTU AGUS WIJAYA, S.Psi', false),
('29323', 'IPDA DAMIRI, SH', false),
('29324', 'KOMPOL IWAN GUNAWAN, SH, MH', false),
('29336', 'BRIPKA YULIAN RAMATHONI, SH', false),
('29338', 'IPTU IHSAN BASNI, S. Psi, MH', false),
('10794', 'IPTU DEWO DEDDI ANANDA, S.Trk,MH', false),
('29322', 'IPTU YUARDI RAHMAD, S.H.', false)
ON CONFLICT (nrp) DO UPDATE SET
  name = EXCLUDED.name;

-- 3. Tampilkan hasil konfirmasi data aset yang berhasil di-insert/update
SELECT code, name, serial_number, status FROM public.assets WHERE code LIKE 'HT-%' ORDER BY code ASC;
