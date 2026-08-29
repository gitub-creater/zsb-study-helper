-- Run this once in Supabase SQL Editor. The browser never receives the service-role key.

create table if not exists public.app_users (
  id text primary key check (id ~ '^u_[A-Za-z0-9]+$'),
  name text not null check (char_length(name) between 2 and 12),
  name_normalized text not null unique,
  password_salt text not null,
  password_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_sessions (
  token_hash text primary key,
  user_id text not null references public.app_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists app_sessions_user_id_idx on public.app_sessions(user_id);
create index if not exists app_sessions_expires_at_idx on public.app_sessions(expires_at);

create table if not exists public.user_states (
  user_id text primary key references public.app_users(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.app_users enable row level security;
alter table public.app_sessions enable row level security;
alter table public.user_states enable row level security;

-- Deliberately no anon/authenticated policies: only Vercel API routes using the service-role key may access data.
