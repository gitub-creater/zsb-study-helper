-- Migration: Add email support to app_users
-- Run this in Supabase SQL Editor after the initial schema.sql

-- Add email column (nullable for backward compatibility with existing accounts)
alter table public.app_users add column if not exists email text;

-- Add unique constraint on email (only for non-null values)
create unique index if not exists app_users_email_unique on public.app_users(email) where email is not null;

-- Add email validation constraint
alter table public.app_users add constraint email_format_check 
  check (email is null or email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$');

-- Add index for faster email lookups
create index if not exists app_users_email_idx on public.app_users(email) where email is not null;
