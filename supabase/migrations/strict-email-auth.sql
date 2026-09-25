-- Strict email-auth migration.
-- Run after email-verification-migration.sql and the account schema.
-- Every public authentication action must consume a purpose-scoped code.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.email_verification_codes
  add column if not exists purpose text not null default 'login';

update public.email_verification_codes
set purpose = 'login'
where purpose is null or purpose = '';

alter table public.email_verification_codes
  drop constraint if exists email_verification_codes_purpose_check;
alter table public.email_verification_codes
  add constraint email_verification_codes_purpose_check
  check (purpose in ('login', 'register', 'reset_password'));

create index if not exists idx_email_codes_purpose_lookup
  on public.email_verification_codes(email, purpose, code, expires_at)
  where not used;

-- Replace the old three-argument function whose third argument was the IP.
drop function if exists public.send_verification_code(text, text, text);

create or replace function public.send_verification_code(
  p_email text,
  p_code text,
  p_purpose text default 'login',
  p_ip text default null
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_last_sent timestamptz;
  v_wait_seconds int;
begin
  if p_email is null or p_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Z|a-z]{2,}$' then
    return jsonb_build_object('success', false, 'error', '邮箱格式不正确');
  end if;
  if p_purpose not in ('login', 'register', 'reset_password') then
    return jsonb_build_object('success', false, 'error', '验证码用途不正确');
  end if;

  select created_at into v_last_sent
  from public.email_verification_codes
  where lower(email) = lower(p_email)
    and purpose = p_purpose
  order by created_at desc
  limit 1;

  if v_last_sent is not null and v_last_sent > now() - interval '60 seconds' then
    v_wait_seconds := greatest(1, 60 - extract(epoch from now() - v_last_sent)::int);
    return jsonb_build_object(
      'success', false,
      'error', '请稍后再试',
      'waitSeconds', v_wait_seconds
    );
  end if;

  insert into public.email_verification_codes(email, code, purpose, expires_at, ip_address)
  values (lower(btrim(p_email)), p_code, p_purpose, now() + interval '10 minutes', p_ip);

  return jsonb_build_object('success', true, 'expiresIn', 600);
end;
$$;

create or replace function public.consume_email_code(
  p_email text,
  p_code text,
  p_purpose text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if p_purpose not in ('login', 'register', 'reset_password') then
    return jsonb_build_object('success', false, 'error', '验证码用途不正确');
  end if;

  select id into v_id
  from public.email_verification_codes
  where lower(email) = lower(btrim(p_email))
    and code = btrim(p_code)
    and purpose = p_purpose
    and not used
    and expires_at > now()
  order by created_at desc
  limit 1
  for update;

  if v_id is null then
    return jsonb_build_object('success', false, 'error', '验证码错误或已过期');
  end if;

  update public.email_verification_codes
  set used = true
  where id = v_id;

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.zsb_login_verified(
  p_name text,
  p_password text,
  p_email text,
  p_code text
) returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_row public.app_users;
  v_existing_email text;
  v_code jsonb;
  v_token text;
begin
  select * into v_row
  from public.app_users
  where name_normalized = public.zsb_normalize_name(p_name);
  if not found then
    return json_build_object('code', 'not_found', 'error', '账号不存在');
  end if;

  if p_password is null or p_email is null or p_code is null then
    return json_build_object('code', 'invalid_input', 'error', '账号、密码、邮箱和验证码不能为空');
  end if;
  if not public.zsb_password_ok(p_password, v_row.password_salt, v_row.password_hash)
     and v_row.password_salt = 'bf' then
    return json_build_object('code', 'bad_password', 'error', '密码不正确');
  end if;
  if v_row.password_salt <> 'bf' then
    return json_build_object('code', 'legacy_account', 'error', '该账号需要先通过主通道登录一次完成升级');
  end if;

  if v_row.email is not null and lower(v_row.email) <> lower(btrim(p_email)) then
    return json_build_object('code', 'email_mismatch', 'error', '邮箱与账号绑定信息不一致');
  end if;

  select id into v_existing_email
  from public.app_users
  where lower(email) = lower(btrim(p_email))
    and id <> v_row.id
  limit 1;
  if v_existing_email is not null then
    return json_build_object('code', 'email_taken', 'error', '该邮箱已绑定其他账号');
  end if;

  v_code := public.consume_email_code(p_email, p_code, 'login');
  if coalesce((v_code->>'success')::boolean, false) is not true then
    return v_code;
  end if;

  if v_row.email is null then
    update public.app_users
    set email = lower(btrim(p_email)), updated_at = now()
    where id = v_row.id;
  end if;

  v_token := replace(replace(replace(encode(gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'), '=', '');
  insert into public.app_sessions(token_hash, user_id, expires_at)
  values (public.zsb_token_hash(v_token), v_row.id, now() + interval '30 days');

  return json_build_object(
    'user', json_build_object('id', v_row.id, 'name', v_row.name, 'email', coalesce(v_row.email, lower(btrim(p_email)))),
    'token', v_token
  );
end;
$$;

create or replace function public.zsb_register_verified(
  p_id text,
  p_name text,
  p_password text,
  p_email text,
  p_code text
) returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_norm text := public.zsb_normalize_name(p_name);
  v_email text := lower(btrim(p_email));
  v_code jsonb;
  v_token text;
  v_row public.app_users;
begin
  if p_id is null or p_id !~ '^u_[A-Za-z0-9]+$'
     or p_name is null or char_length(btrim(p_name)) not between 2 and 12
     or p_password is null or char_length(p_password) not between 4 and 128
     or p_email is null or p_email !~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+[.][A-Z|a-z]{2,}$'
     or p_code is null then
    return json_build_object('code', 'invalid_input', 'error', '账号、密码、邮箱或验证码格式不正确');
  end if;

  if exists (select 1 from public.app_users where name_normalized = v_norm) then
    return json_build_object('code', 'name_taken', 'error', '该账号已存在');
  end if;
  if exists (select 1 from public.app_users where lower(email) = v_email) then
    return json_build_object('code', 'email_taken', 'error', '该邮箱已被注册');
  end if;

  v_code := public.consume_email_code(v_email, p_code, 'register');
  if coalesce((v_code->>'success')::boolean, false) is not true then
    return v_code;
  end if;

  insert into public.app_users(id, name, name_normalized, email, password_salt, password_hash)
  values (p_id, btrim(p_name), v_norm, v_email, 'bf', crypt(p_password, gen_salt('bf', 8)))
  returning * into v_row;

  v_token := replace(replace(replace(encode(gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'), '=', '');
  insert into public.app_sessions(token_hash, user_id, expires_at)
  values (public.zsb_token_hash(v_token), v_row.id, now() + interval '30 days');

  return json_build_object(
    'user', json_build_object('id', v_row.id, 'name', v_row.name, 'email', v_row.email),
    'token', v_token
  );
end;
$$;

create or replace function public.zsb_reset_password_verified(
  p_email text,
  p_code text,
  p_new text
) returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_row public.app_users;
  v_code jsonb;
begin
  if p_email is null or p_code is null or p_new is null or char_length(p_new) not between 4 and 128 then
    return json_build_object('code', 'invalid_input', 'error', '邮箱、验证码或新密码格式不正确');
  end if;

  select * into v_row from public.app_users where lower(email) = lower(btrim(p_email));
  if not found then
    return json_build_object('code', 'not_found', 'error', '邮箱未绑定账号');
  end if;

  v_code := public.consume_email_code(p_email, p_code, 'reset_password');
  if coalesce((v_code->>'success')::boolean, false) is not true then
    return v_code;
  end if;

  update public.app_users
  set password_salt = 'bf', password_hash = crypt(p_new, gen_salt('bf', 8)), updated_at = now()
  where id = v_row.id;
  delete from public.app_sessions where user_id = v_row.id;

  return json_build_object('ok', true);
end;
$$;

-- Prevent old password-only and code-only RPCs from becoming bypasses.
-- The conditional block keeps this migration rerunnable on projects that never created the old functions.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.zsb_register(text,text,text)',
    'public.zsb_register(text,text,text,text)',
    'public.zsb_login(text,text)',
    'public.zsb_login_email(text,text)',
    'public.consume_email_code(text,text,text)',
    'public.verify_email_code(text,text)'
  ] loop
    if to_regprocedure(fn) is not null then
      execute format('revoke all on function %s from public, anon, authenticated', fn);
    end if;
  end loop;
end;
$$;

grant execute on function public.send_verification_code(text, text, text, text) to anon, authenticated;
grant execute on function public.zsb_login_verified(text, text, text, text) to anon, authenticated;
grant execute on function public.zsb_register_verified(text, text, text, text, text) to anon, authenticated;
grant execute on function public.zsb_reset_password_verified(text, text, text) to anon, authenticated;

alter table public.email_verification_codes enable row level security;
