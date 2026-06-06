create table if not exists public.months (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  salary numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key,
  month_id uuid not null references public.months(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('expense', 'income', 'loan_sent', 'loan_received')),
  title text not null,
  amount numeric not null check (amount > 0),
  category text not null,
  person text,
  raw_text text,
  created_at timestamptz not null default now()
);

create index if not exists months_user_created_idx on public.months (user_id, created_at desc);
create index if not exists transactions_user_month_created_idx on public.transactions (user_id, month_id, created_at desc);

alter table public.months enable row level security;
alter table public.transactions enable row level security;

drop policy if exists "Users can read own months" on public.months;
create policy "Users can read own months"
  on public.months for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own months" on public.months;
create policy "Users can insert own months"
  on public.months for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own months" on public.months;
create policy "Users can update own months"
  on public.months for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can read own transactions" on public.transactions;
create policy "Users can read own transactions"
  on public.transactions for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own transactions" on public.transactions;
create policy "Users can insert own transactions"
  on public.transactions for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own transactions" on public.transactions;
create policy "Users can update own transactions"
  on public.transactions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
