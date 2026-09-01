-- =========================================================
-- SCHEMA: Peminjaman Aset Komunikasi (HT) - QR Code + Approval FSM
-- Consolidating on single `transactions` table & RPC functions
-- =========================================================

-- ---------- ENUM TYPES ----------
do $$ begin
  create type asset_status as enum ('tersedia', 'dipinjam', 'rusak');
exception
  when duplicate_object then null;
end $$;

-- ---------- PROFILES (extends auth.users) ----------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text,
  nrp text unique,
  phone text,
  avatar_url text,
  role text not null default 'petugas' check (role in ('petugas', 'admin')),
  created_at timestamptz not null default now()
);

alter table profiles add column if not exists email text;

-- Auto-create profile upon auth sign up
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, email, nrp, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', 'Petugas'),
    new.email,
    new.raw_user_meta_data->>'nrp',
    coalesce(new.raw_user_meta_data->>'role', 'petugas')
  )
  on conflict (id) do update set
    full_name = excluded.full_name,
    email = excluded.email,
    nrp = excluded.nrp,
    role = coalesce(excluded.role, public.profiles.role);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ---------- ASSETS ----------
create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,              -- QR code payload
  name text not null,
  serial_number text unique not null,
  status asset_status not null default 'tersedia',
  qr_code text,
  qr_code_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- CONSOLIDATED TRANSACTIONS TABLE ----------
create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  user_id uuid references profiles(id) on delete set null,
  borrower_name text,
  borrower_nrp text,
  kesatuan text,
  action text not null check (action in ('BORROW', 'RETURN')),
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  condition text,
  notes text,
  created_at timestamptz not null default now()
);

-- Schema migration additions if columns don't exist yet
alter table transactions add column if not exists user_id uuid references profiles(id);
alter table transactions add column if not exists borrower_name text;
alter table transactions add column if not exists borrower_nrp text;
alter table transactions add column if not exists kesatuan text;
alter table transactions add column if not exists status text not null default 'PENDING'
  check (status in ('PENDING', 'APPROVED', 'REJECTED'));
alter table transactions add column if not exists reviewed_by uuid references profiles(id);
alter table transactions add column if not exists reviewed_at timestamptz;
alter table transactions add column if not exists rejection_reason text;
alter table transactions add column if not exists condition text;
alter table transactions add column if not exists notes text;

alter table assets add column if not exists qr_code text;
alter table assets add column if not exists qr_code_url text;

-- ---------- ASSET STATE LOGS (FSM Audit Trail) ----------
create table if not exists asset_state_logs (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references assets(id) on delete cascade,
  from_state asset_status,
  to_state asset_status not null,
  triggered_by uuid references profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);

-- =========================================================
-- SERVER-SIDE FSM GUARD & ATOMIC TRANSACTION RPC
-- =========================================================

-- 1. process_asset_transaction (BORROW -> PENDING, RETURN -> Instant APPROVED)
create or replace function process_asset_transaction(
  p_asset_id uuid,
  p_action text,
  p_borrower_name text default null,
  p_borrower_nrp text default null,
  p_kesatuan text default null,
  p_condition text default null,
  p_notes text default null
) returns uuid as $$
declare
  v_current_status asset_status;
  v_new_status asset_status;
  v_trans_id uuid;
  v_user_id uuid;
  v_action text;
  v_pending_count int;
begin
  v_user_id := auth.uid();
  v_action := upper(trim(p_action));

  -- Lock row & retrieve current asset status
  select status into v_current_status from assets where id = p_asset_id for update;

  if v_current_status is null then
    raise exception 'Aset tidak ditemukan.';
  end if;

  -- Enforce Server-Side FSM State Transitions
  if v_action = 'BORROW' then
    if v_current_status <> 'tersedia' then
      raise exception 'Aset tidak dapat dipinjam (status saat ini: %).', v_current_status;
    end if;

    -- Check duplicate pending borrow requests for the same asset
    select count(*) into v_pending_count
    from transactions
    where asset_id = p_asset_id and action = 'BORROW' and status = 'PENDING';

    if v_pending_count > 0 then
      raise exception 'Aset ini sudah ada pengajuan peminjaman lain yang menunggu persetujuan.';
    end if;

    -- Insert pending transaction (do NOT change asset status yet)
    insert into transactions (
      asset_id,
      user_id,
      borrower_name,
      borrower_nrp,
      kesatuan,
      action,
      status,
      notes
    ) values (
      p_asset_id,
      v_user_id,
      p_borrower_name,
      p_borrower_nrp,
      p_kesatuan,
      'BORROW',
      'PENDING',
      p_notes
    ) returning id into v_trans_id;

    return v_trans_id;

  elsif v_action = 'RETURN' then
    if v_current_status <> 'dipinjam' then
      raise exception 'Aset tidak dalam status dipinjam (status saat ini: %).', v_current_status;
    end if;

    if p_condition is not null and lower(p_condition) like '%rusak%' then
      v_new_status := 'rusak'::asset_status;
    else
      v_new_status := 'tersedia'::asset_status;
    end if;

    -- 1. Atomic Asset Status Update
    update assets set status = v_new_status, updated_at = now() where id = p_asset_id;

    -- 2. Insert Approved Return Transaction
    insert into transactions (
      asset_id,
      user_id,
      borrower_name,
      borrower_nrp,
      kesatuan,
      action,
      status,
      condition,
      notes,
      reviewed_by,
      reviewed_at
    ) values (
      p_asset_id,
      v_user_id,
      p_borrower_name,
      p_borrower_nrp,
      p_kesatuan,
      'RETURN',
      'APPROVED',
      p_condition,
      p_notes,
      v_user_id,
      now()
    ) returning id into v_trans_id;

    -- 3. Audit Log Entry
    insert into asset_state_logs (
      asset_id,
      from_state,
      to_state,
      triggered_by,
      reason
    ) values (
      p_asset_id,
      v_current_status,
      v_new_status,
      v_user_id,
      'RETURN by ' || coalesce(p_borrower_name, 'petugas')
    );

    return v_trans_id;

  else
    raise exception 'Aksi tidak valid: %. Harus BORROW atau RETURN.', p_action;
  end if;
end;
$$ language plpgsql security definer;

-- 2. approve_transaction RPC
create or replace function approve_transaction(p_transaction_id uuid)
returns void as $$
declare
  v_role text;
  v_asset_id uuid;
  v_status text;
  v_action text;
  v_asset_status asset_status;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is distinct from 'admin' then
    raise exception 'Akses ditolak: hanya admin yang dapat menyetujui peminjaman.';
  end if;

  select asset_id, status, action into v_asset_id, v_status, v_action
  from transactions where id = p_transaction_id for update;

  if v_status is null then
    raise exception 'Transaksi tidak ditemukan.';
  end if;
  if v_status <> 'PENDING' or v_action <> 'BORROW' then
    raise exception 'Transaksi ini tidak dalam status menunggu persetujuan.';
  end if;

  select status into v_asset_status from assets where id = v_asset_id for update;
  if v_asset_status <> 'tersedia' then
    raise exception 'Aset sudah tidak tersedia (status saat ini: %). Tolak pengajuan ini.', v_asset_status;
  end if;

  update transactions set status = 'APPROVED', reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_transaction_id;

  insert into asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
  values (v_asset_id, 'tersedia', 'disetujui', auth.uid(), 'Peminjaman disetujui admin. Menunggu scan serah terima fisik.');
end;
$$ language plpgsql security definer;

-- 3. reject_transaction RPC
create or replace function reject_transaction(p_transaction_id uuid, p_reason text default null)
returns void as $$
declare
  v_role text;
  v_status text;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is distinct from 'admin' then
    raise exception 'Akses ditolak: hanya admin yang dapat menolak peminjaman.';
  end if;

  select status into v_status from transactions where id = p_transaction_id for update;
  if v_status is null then
    raise exception 'Transaksi tidak ditemukan.';
  end if;
  if v_status <> 'PENDING' then
    raise exception 'Transaksi ini sudah diproses sebelumnya.';
  end if;

  update transactions
  set status = 'REJECTED', reviewed_by = auth.uid(), reviewed_at = now(),
      rejection_reason = coalesce(p_reason, 'Ditolak oleh admin')
  where id = p_transaction_id;
end;
$$ language plpgsql security definer;

-- 4. admin_override_asset_status RPC
create or replace function admin_override_asset_status(
  p_asset_id uuid, p_new_status asset_status, p_reason text default 'Override manual oleh admin'
) returns void as $$
declare
  v_role text;
  v_current asset_status;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is distinct from 'admin' then
    raise exception 'Akses ditolak: hanya admin yang dapat override status.';
  end if;
  select status into v_current from assets where id = p_asset_id for update;
  if v_current is null then raise exception 'Aset tidak ditemukan.'; end if;
  if v_current = p_new_status then raise exception 'Aset sudah berstatus %.', p_new_status; end if;
  update assets set status = p_new_status, updated_at = now() where id = p_asset_id;
  insert into asset_state_logs (asset_id, from_state, to_state, triggered_by, reason)
  values (p_asset_id, v_current, p_new_status, auth.uid(), p_reason);
end;
$$ language plpgsql security definer;

-- 5. admin_upsert_asset RPC
create or replace function admin_upsert_asset(
  p_id uuid default null, p_code text default null, p_name text default null, p_serial_number text default null
) returns uuid as $$
declare
  v_role text;
  v_id uuid;
begin
  select role into v_role from profiles where id = auth.uid();
  if v_role is distinct from 'admin' then
    raise exception 'Akses ditolak: hanya admin yang dapat mengelola data aset.';
  end if;

  if p_id is null then
    insert into assets (code, name, serial_number, status, qr_code_url)
    values (p_code, p_name, p_serial_number, 'tersedia', 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' || p_code)
    returning id into v_id;
  else
    update assets set
      code = coalesce(p_code, code),
      name = coalesce(p_name, name),
      serial_number = coalesce(p_serial_number, serial_number),
      qr_code_url = 'https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' || coalesce(p_code, code),
      updated_at = now()
    where id = p_id returning id into v_id;
  end if;

  return v_id;
end;
$$ language plpgsql security definer;

-- 6. admin_update_user_role RPC
create or replace function admin_update_user_role(
  p_target_user_id uuid,
  p_new_role text
) returns void as $$
declare
  v_caller_role text;
begin
  select role into v_caller_role from profiles where id = auth.uid();
  if v_caller_role is distinct from 'admin' then
    raise exception 'Akses ditolak: hanya admin yang dapat mengubah role user.';
  end if;

  if p_new_role not in ('petugas', 'admin') then
    raise exception 'Role tidak valid: %. Harus petugas atau admin.', p_new_role;
  end if;

  update profiles set role = p_new_role where id = p_target_user_id;
end;
$$ language plpgsql security definer;

-- 7. get_email_by_identifier RPC (Allows unauthenticated users to lookup email by Name/NRP)
create or replace function get_email_by_identifier(p_identifier text)
returns text as $$
declare
  v_email text;
begin
  select email into v_email
  from public.profiles
  where full_name ilike '%' || trim(p_identifier) || '%'
     or nrp ilike '%' || trim(p_identifier) || '%'
  limit 1;

  return v_email;
end;
$$ language plpgsql security definer;

-- =========================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- =========================================================
alter table profiles enable row level security;
alter table assets enable row level security;
alter table transactions enable row level security;
alter table asset_state_logs enable row level security;

-- profiles policy
drop policy if exists "profiles_select_own" on profiles;
drop policy if exists "profiles_select_all" on profiles;
create policy "profiles_select_all" on profiles for select using (auth.role() = 'authenticated');

drop policy if exists "profiles_update_own" on profiles;
create policy "profiles_update_own" on profiles for update using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on profiles;
create policy "profiles_insert_own" on profiles for insert with check (auth.uid() = id);

-- assets policy (NO direct update policy for non-RPCs!)
drop policy if exists "assets_select_all" on assets;
create policy "assets_select_all" on assets for select using (auth.role() = 'authenticated');

drop policy if exists "assets_update_authenticated" on assets;

-- transactions policy
drop policy if exists "transactions_select_all" on transactions;
create policy "transactions_select_all" on transactions for select using (auth.role() = 'authenticated');

drop policy if exists "transactions_insert_authenticated" on transactions;
create policy "transactions_insert_authenticated" on transactions for insert with check (auth.role() = 'authenticated');

-- asset_state_logs policy
drop policy if exists "logs_select_all" on asset_state_logs;
create policy "logs_select_all" on asset_state_logs for select using (auth.role() = 'authenticated');

-- =========================================================
-- SUPABASE REALTIME PUBLICATION
-- =========================================================
begin;
  drop publication if exists supabase_realtime;
  create publication supabase_realtime for table assets, transactions, profiles;
commit;

-- =========================================================
-- PROFILE EMAIL SYNC & DEFAULT ROLE HELPER
-- =========================================================
do $$
begin
  -- 1. Sync all profile emails from auth.users
  update public.profiles p
  set email = u.email
  from auth.users u
  where p.id = u.id and (p.email is null or p.email <> u.email);

  -- 2. Ensure default role is 'petugas'
  update public.profiles
  set role = 'petugas'
  where role is null;
end $$;
