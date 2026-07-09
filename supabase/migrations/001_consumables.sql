-- Supabase SQL Editor에서 실행하세요.
-- 내부용 starter 기준입니다. 운영 전에는 Supabase Auth/RLS 정책을 회사 보안 기준에 맞춰 조정하세요.

create extension if not exists pgcrypto;

create table if not exists public.consumable_uploads (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  month int not null check (month between 1 and 12),
  department text not null check (department in ('cleaning', 'food')),
  original_file_name text not null,
  storage_path text,
  status text not null default 'draft' check (status in ('draft', 'validated', 'confirmed')),
  uploaded_by uuid,
  uploaded_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(year, month, department)
);

create table if not exists public.consumable_items (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid references public.consumable_uploads(id) on delete cascade,
  year int not null,
  month int not null check (month between 1 and 12),
  department text not null check (department in ('cleaning', 'food')),
  no numeric,
  major_category text,
  middle_category text,
  sub_category text,
  item_name text not null,
  specification text,
  unit text,
  location text,
  prev_qty numeric default 0,
  in_qty numeric default 0,
  used_qty numeric default 0,
  current_qty numeric default 0,
  unit_price numeric default 0,
  prev_amount numeric default 0,
  in_amount numeric default 0,
  used_amount numeric default 0,
  current_amount numeric default 0,
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.consumable_validation_errors (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid references public.consumable_uploads(id) on delete cascade,
  row_no numeric,
  item_name text,
  error_level text check (error_level in ('warning', 'error')),
  error_type text,
  message text,
  created_at timestamptz default now()
);

create table if not exists public.consumable_audit_logs (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.consumable_items(id) on delete cascade,
  field_name text not null,
  old_value text,
  new_value text,
  edited_by uuid,
  edited_at timestamptz default now()
);

create index if not exists consumable_items_month_idx
  on public.consumable_items(year, month, department);

create index if not exists consumable_items_item_idx
  on public.consumable_items(item_name, specification, location);

-- Storage bucket은 SQL Editor 또는 Storage 메뉴에서 생성하세요.
-- insert into storage.buckets (id, name, public) values ('consumable-files', 'consumable-files', false)
-- on conflict (id) do nothing;

-- 개발 편의용 정책 예시입니다. 운영 전에는 반드시 인증 사용자/역할 기반으로 좁히세요.
-- alter table public.consumable_uploads enable row level security;
-- alter table public.consumable_items enable row level security;
-- alter table public.consumable_validation_errors enable row level security;
-- alter table public.consumable_audit_logs enable row level security;
-- create policy "authenticated read uploads" on public.consumable_uploads for select to authenticated using (true);
-- create policy "authenticated write uploads" on public.consumable_uploads for all to authenticated using (true) with check (true);
-- create policy "authenticated read items" on public.consumable_items for select to authenticated using (true);
-- create policy "authenticated write items" on public.consumable_items for all to authenticated using (true) with check (true);
-- create policy "authenticated read errors" on public.consumable_validation_errors for select to authenticated using (true);
-- create policy "authenticated write errors" on public.consumable_validation_errors for all to authenticated using (true) with check (true);
-- create policy "authenticated read audit" on public.consumable_audit_logs for select to authenticated using (true);
-- create policy "authenticated write audit" on public.consumable_audit_logs for insert to authenticated with check (true);
