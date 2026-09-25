-- 大陆直连账号通道:vercel.app 在中国大陆被封(DNS 污染 + 真实 IP TLS 重置),
-- 而 <project>.supabase.co 走 Cloudflare 实测可直连。把账号相关接口做成
-- SECURITY DEFINER 的 RPC,授权给 anon,让客户端在 Vercel 不可达时仍能完成
-- 注册/登录/找用户/读写学习快照。密码只以 scrypt 无法用时的 pgcrypto 摘要保存,
-- 表结构和 RLS 保持不变(anon 仍然不能直接读写 app_users)。

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- 会话令牌只存 sha256 摘要,和 Vercel 端 server/cloud-api.ts 保持一致。
create or replace function public.zsb_token_hash(p_token text)
returns text language sql immutable
set search_path = public, extensions, pg_temp as $$
  select encode(digest(p_token, 'sha256'), 'hex')
$$;

create or replace function public.zsb_normalize_name(p_name text)
returns text language sql immutable
set search_path = public, extensions, pg_temp as $$
  select lower(btrim(p_name))
$$;

-- password_salt='bf' 表示 password_hash 里存的是 pgcrypto bcrypt;
-- 其余取值是旧版 Vercel 写入的 scrypt(数据库端无法校验)。
create or replace function public.zsb_password_ok(
  p_password text, p_salt text, p_hash text
) returns boolean
language plpgsql immutable set search_path = public, extensions, pg_temp as $$
begin
  if p_salt = 'bf' then
    return p_hash = crypt(p_password, p_hash);
  end if;
  return false; -- 旧版 scrypt 只能由主通道校验
end $$;

-- 大陆通道自己的密码方案:pgcrypto crypt/bf。与 Vercel 的 scrypt 不同,
-- 因此 password_salt 用 'bf' 标记该行由哪条通道写入,校验时按标记分派。
create or replace function public.zsb_register(
  p_id text, p_name text, p_password text, p_email text default null
) returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_norm text := public.zsb_normalize_name(p_name);
  v_row public.app_users;
  v_token text;
begin
  if p_id is null or p_id !~ '^u_[A-Za-z0-9]+$' then
    return json_build_object('code','invalid_input','error','账号或密码格式不正确');
  end if;
  if p_name is null or char_length(btrim(p_name)) < 2 or char_length(btrim(p_name)) > 12 then
    return json_build_object('code','invalid_input','error','账号或密码格式不正确');
  end if;
  if p_password is null or char_length(p_password) < 4 or char_length(p_password) > 128 then
    return json_build_object('code','invalid_input','error','账号或密码格式不正确');
  end if;
  if p_email is not null and p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    return json_build_object('code','invalid_input','error','邮箱格式不正确');
  end if;

  select * into v_row from public.app_users where name_normalized = v_norm or lower(email) = lower(nullif(btrim(p_email),''));
  if found then
    -- 网络在响应返回前中断时客户端会重试:同 ID 同密码才允许复用,否则视为占用。
    if v_row.id <> p_id then
      return json_build_object('code','name_taken','error','该账号已存在');
    end if;
    if v_row.password_salt <> 'bf' then
      return json_build_object('code','legacy_account','error','该账号需要先在主通道登录一次完成升级');
    end if;
    if not public.zsb_password_ok(p_password, v_row.password_salt, v_row.password_hash) then
      return json_build_object('code','name_taken','error','该账号已存在');
    end if;
  else
    insert into public.app_users(id, name, name_normalized, email, password_salt, password_hash)
    values (p_id, btrim(p_name), v_norm, nullif(btrim(p_email),''), 'bf', crypt(p_password, gen_salt('bf', 8)))
    returning * into v_row;
  end if;

  v_token := encode(gen_random_bytes(32), 'base64');
  v_token := replace(replace(replace(v_token,'+','-'),'/','_'),'=','');
  insert into public.app_sessions(token_hash, user_id, expires_at)
  values (public.zsb_token_hash(v_token), v_row.id, now() + interval '30 days');

  return json_build_object('user', json_build_object('id', v_row.id, 'name', v_row.name, 'email', v_row.email), 'token', v_token);
end $$;

create or replace function public.zsb_login(p_name text, p_password text)
returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_row public.app_users;
  v_token text;
begin
  select * into v_row from public.app_users
   where name_normalized = public.zsb_normalize_name(p_name) or lower(email) = lower(btrim(p_name));
  if not found then
    return json_build_object('code','not_found','error','账号不存在');
  end if;
  if v_row.password_salt <> 'bf' then
    -- 旧版账号的 scrypt 摘要只能由 Vercel 通道校验,登录成功后会自动补写 bcrypt。
    return json_build_object('code','legacy_account','error','该账号需要先在主通道登录一次完成升级');
  end if;
  if not public.zsb_password_ok(p_password, v_row.password_salt, v_row.password_hash) then
    return json_build_object('code','bad_password','error','密码不正确');
  end if;

  v_token := encode(gen_random_bytes(32), 'base64');
  v_token := replace(replace(replace(v_token,'+','-'),'/','_'),'=','');
  insert into public.app_sessions(token_hash, user_id, expires_at)
  values (public.zsb_token_hash(v_token), v_row.id, now() + interval '30 days');
  return json_build_object('user', json_build_object('id', v_row.id, 'name', v_row.name, 'email', v_row.email), 'token', v_token);
end $$;

-- 会话校验:过期即视为无效,顺带清理过期行。
create or replace function public.zsb_session_user(p_token text)
returns text
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_uid text;
begin
  delete from public.app_sessions where expires_at <= now();
  select user_id into v_uid from public.app_sessions
   where token_hash = public.zsb_token_hash(p_token) and expires_at > now();
  return v_uid;
end $$;

-- 好友查找:与 Vercel /api/auth/users 行为一致(精确账号名 → 精确 ID → 前缀模糊),排除自己。

-- 邮箱登录:通过邮箱而非用户名登录
create or replace function public.zsb_login_email(p_email text, p_password text)
returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_row public.app_users;
  v_token text;
begin
  select * into v_row from public.app_users
   where lower(email) = lower(p_email);
  if not found then
    return json_build_object('code','not_found','error','邮箱不存在');
  end if;
  if v_row.password_salt <> 'bf' then
    return json_build_object('code','legacy_account','error','该账号需要先在主通道登录一次完成升级');
  end if;
  if not extensions.crypt(p_password, v_row.password_hash) = v_row.password_hash then
    return json_build_object('code','wrong_password','error','密码错误');
  end if;
  v_token := encode(extensions.gen_random_bytes(24),'base64');
  insert into public.sessions(user_id, token) values (v_row.id, v_token);
  return json_build_object(
    'code','ok',
    'token',v_token,
    'user_id',v_row.id,
    'user_name',v_row.name
  );
end;
$$;

create or replace function public.zsb_find_users(p_token text, p_query text)
returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_me text := public.zsb_session_user(p_token);
  v_q text := btrim(coalesce(p_query,''));
  v_rows json;
begin
  if v_me is null then
    return json_build_object('code','unauthorized','error','登录已过期，请重新登录');
  end if;
  if v_q = '' then
    return json_build_object('code','invalid_input','error','请输入要查找的账号');
  end if;

  select coalesce(json_agg(json_build_object('id', id, 'name', name)), '[]'::json) into v_rows
  from (
    select id, name from public.app_users
     where name_normalized = public.zsb_normalize_name(v_q) and id <> v_me
     limit 10
  ) t;
  if v_rows::text <> '[]' then return json_build_object('users', v_rows); end if;

  select coalesce(json_agg(json_build_object('id', id, 'name', name)), '[]'::json) into v_rows
  from (select id, name from public.app_users where id = v_q and id <> v_me limit 1) t;
  if v_rows::text <> '[]' then return json_build_object('users', v_rows); end if;

  select coalesce(json_agg(json_build_object('id', id, 'name', name)), '[]'::json) into v_rows
  from (
    select id, name from public.app_users
     where name_normalized like '%' || replace(replace(replace(public.zsb_normalize_name(v_q),'%',' '),'_',' '),',',' ') || '%'
       and id <> v_me
     limit 10
  ) t;
  return json_build_object('users', v_rows);
end $$;

create or replace function public.zsb_get_state(p_token text)
returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_me text := public.zsb_session_user(p_token);
  v_state jsonb;
begin
  if v_me is null then
    return json_build_object('code','unauthorized','error','登录已过期，请重新登录');
  end if;
  select state into v_state from public.user_states where user_id = v_me;
  return json_build_object('state', v_state);
end $$;

create or replace function public.zsb_put_state(p_token text, p_state jsonb)
returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_me text := public.zsb_session_user(p_token);
begin
  if v_me is null then
    return json_build_object('code','unauthorized','error','登录已过期，请重新登录');
  end if;
  if p_state is null or jsonb_typeof(p_state) <> 'object' then
    return json_build_object('code','invalid_input','error','状态格式不正确');
  end if;
  insert into public.user_states(user_id, state, updated_at)
  values (v_me, p_state, now())
  on conflict (user_id) do update set state = excluded.state, updated_at = now();
  return json_build_object('ok', true);
end $$;

-- 仅供主通道(service_role)在登录成功后把旧版 scrypt 账号补写成 bcrypt,
-- 使其之后可以在国内直连通道登录。不授权给 anon。
create or replace function public.zsb_set_bf_password(p_id text, p_password text)
returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  update public.app_users
     set password_salt = 'bf', password_hash = crypt(p_password, gen_salt('bf', 8)), updated_at = now()
   where id = p_id;
  if not found then
    return json_build_object('code','not_found','error','账号不存在');
  end if;
  return json_build_object('ok', true);
end $$;

-- 严格邮箱二次认证:验证码用途由 email_verification_codes.purpose 隔离。
-- 需要先执行 supabase/migrations/strict-email-auth.sql。
create or replace function public.zsb_login_verified(
  p_name text, p_password text, p_email text, p_code text
) returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_row public.app_users;
  v_token text;
  v_code jsonb;
  v_other text;
begin
  select * into v_row from public.app_users where name_normalized = public.zsb_normalize_name(p_name);
  if not found then return json_build_object('code','not_found','error','账号不存在'); end if;
  if p_password is null or p_email is null or p_code is null then
    return json_build_object('code','invalid_input','error','账号、密码、邮箱和验证码不能为空');
  end if;
  if v_row.password_salt <> 'bf' then
    return json_build_object('code','legacy_account','error','该账号需要先通过主通道登录一次完成升级');
  end if;
  if not public.zsb_password_ok(p_password, v_row.password_salt, v_row.password_hash) then
    return json_build_object('code','bad_password','error','密码不正确');
  end if;
  if v_row.email is not null and lower(v_row.email) <> lower(btrim(p_email)) then
    return json_build_object('code','email_mismatch','error','邮箱与账号绑定信息不一致');
  end if;
  select id into v_other from public.app_users where lower(email) = lower(btrim(p_email)) and id <> v_row.id limit 1;
  if v_other is not null then return json_build_object('code','email_taken','error','该邮箱已绑定其他账号'); end if;

  v_code := public.consume_email_code(p_email, p_code, 'login');
  if coalesce((v_code->>'success')::boolean, false) is not true then return v_code; end if;
  if v_row.email is null then
    update public.app_users set email = lower(btrim(p_email)), updated_at = now() where id = v_row.id;
  end if;
  v_token := replace(replace(replace(encode(gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'), '=', '');
  insert into public.app_sessions(token_hash, user_id, expires_at) values (public.zsb_token_hash(v_token), v_row.id, now() + interval '30 days');
  return json_build_object('user', json_build_object('id', v_row.id, 'name', v_row.name, 'email', coalesce(v_row.email, lower(btrim(p_email)))), 'token', v_token);
end $$;

create or replace function public.zsb_register_verified(
  p_id text, p_name text, p_password text, p_email text, p_code text
) returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_norm text := public.zsb_normalize_name(p_name);
  v_email text := lower(btrim(p_email));
  v_code jsonb;
  v_token text;
  v_row public.app_users;
begin
  if p_id is null or p_id !~ '^u_[A-Za-z0-9]+$' or p_name is null or char_length(btrim(p_name)) not between 2 and 12 or p_password is null or char_length(p_password) not between 4 and 128 or p_email is null or p_email !~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or p_code is null then
    return json_build_object('code','invalid_input','error','账号、密码、邮箱或验证码格式不正确');
  end if;
  if exists (select 1 from public.app_users where name_normalized = v_norm) then return json_build_object('code','name_taken','error','该账号已存在'); end if;
  if exists (select 1 from public.app_users where lower(email) = v_email) then return json_build_object('code','email_taken','error','该邮箱已被注册'); end if;
  v_code := public.consume_email_code(v_email, p_code, 'register');
  if coalesce((v_code->>'success')::boolean, false) is not true then return v_code; end if;
  insert into public.app_users(id, name, name_normalized, email, password_salt, password_hash)
  values (p_id, btrim(p_name), v_norm, v_email, 'bf', crypt(p_password, gen_salt('bf', 8))) returning * into v_row;
  v_token := replace(replace(replace(encode(gen_random_bytes(32), 'base64'), '+', '-'), '/', '_'), '=', '');
  insert into public.app_sessions(token_hash, user_id, expires_at) values (public.zsb_token_hash(v_token), v_row.id, now() + interval '30 days');
  return json_build_object('user', json_build_object('id', v_row.id, 'name', v_row.name, 'email', v_row.email), 'token', v_token);
end $$;

create or replace function public.zsb_reset_password_verified(
  p_email text, p_code text, p_new text
) returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_row public.app_users;
  v_code jsonb;
begin
  if p_email is null or p_code is null or p_new is null or char_length(p_new) not between 4 and 128 then return json_build_object('code','invalid_input','error','邮箱、验证码或新密码格式不正确'); end if;
  select * into v_row from public.app_users where lower(email) = lower(btrim(p_email));
  if not found then return json_build_object('code','not_found','error','邮箱未绑定账号'); end if;
  v_code := public.consume_email_code(p_email, p_code, 'reset_password');
  if coalesce((v_code->>'success')::boolean, false) is not true then return v_code; end if;
  update public.app_users set password_salt = 'bf', password_hash = crypt(p_new, gen_salt('bf', 8)), updated_at = now() where id = v_row.id;
  delete from public.app_sessions where user_id = v_row.id;
  return json_build_object('ok', true);
end $$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.zsb_register(text,text,text)',
    'public.zsb_register(text,text,text,text)',
    'public.zsb_login(text,text)',
    'public.zsb_login_email(text,text)',
    'public.zsb_login_verified(text,text,text,text)',
    'public.zsb_register_verified(text,text,text,text,text)',
    'public.zsb_reset_password_verified(text,text,text)',
    'public.verify_email_code(text,text)',
    'public.consume_email_code(text,text,text)'
  ] loop
    if to_regprocedure(fn) is not null then
      execute format('revoke all on function %s from public, anon, authenticated', fn);
    end if;
  end loop;
end;
$$;

grant execute on function public.zsb_login_verified(text,text,text,text) to anon, authenticated;
grant execute on function public.zsb_register_verified(text,text,text,text,text) to anon, authenticated;
grant execute on function public.zsb_reset_password_verified(text,text,text) to anon, authenticated;

-- 只暴露这几个函数;app_users/app_sessions/user_states 的 RLS 仍然拦住 anon 直接读写。
revoke all on function public.zsb_find_users(text,text) from public, anon, authenticated;
revoke all on function public.zsb_get_state(text) from public, anon, authenticated;
revoke all on function public.zsb_put_state(text,jsonb) from public, anon, authenticated;
revoke all on function public.zsb_set_bf_password(text,text) from public, anon, authenticated;
revoke all on function public.zsb_session_user(text) from public, anon, authenticated;

grant execute on function public.zsb_find_users(text,text) to anon, authenticated;
grant execute on function public.zsb_get_state(text) to anon, authenticated;
grant execute on function public.zsb_put_state(text,jsonb) to anon, authenticated;
grant execute on function public.zsb_set_bf_password(text,text) to service_role;

-- 改密码:直连通道自己就能完成,校验旧密码后写入新的 bcrypt 摘要。
create or replace function public.zsb_change_password(
  p_token text, p_old text, p_new text
) returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_me text := public.zsb_session_user(p_token);
  v_row public.app_users;
begin
  if v_me is null then
    return json_build_object('code','unauthorized','error','登录已过期，请重新登录');
  end if;
  if p_new is null or char_length(p_new) < 4 or char_length(p_new) > 128 then
    return json_build_object('code','invalid_input','error','新密码至少 4 位');
  end if;
  select * into v_row from public.app_users where id = v_me;
  if not found then
    return json_build_object('code','not_found','error','账号不存在');
  end if;
  if not public.zsb_password_ok(p_old, v_row.password_salt, v_row.password_hash) then
    return json_build_object('code','bad_password','error','原密码不正确');
  end if;
  update public.app_users
     set password_salt = 'bf', password_hash = crypt(p_new, gen_salt('bf', 8)), updated_at = now()
   where id = v_me;
  -- 换密码后旧会话一律失效,只保留当前令牌。
  delete from public.app_sessions
   where user_id = v_me and token_hash <> public.zsb_token_hash(p_token);
  return json_build_object('ok', true);
end $$;

revoke all on function public.zsb_change_password(text,text,text) from public, anon, authenticated;
grant execute on function public.zsb_change_password(text,text,text) to anon, authenticated;

-- 旧账号无缝升级:早期账号的密码是 Vercel 用 scrypt 存的,数据库端无法校验。
-- 用户只要在能连上主通道的环境登录成功一次,客户端就拿着刚签发的会话令牌调用这里,
-- 把同一个密码补写成 bcrypt,此后该账号在国内直连通道也能登录。
-- 安全性:必须已持有有效会话令牌(等于已通过主通道验明身份),且只能改自己。
create or replace function public.zsb_adopt_password(p_token text, p_password text)
returns json
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_me text := public.zsb_session_user(p_token);
begin
  if v_me is null then
    return json_build_object('code','unauthorized','error','登录已过期，请重新登录');
  end if;
  if p_password is null or char_length(p_password) < 4 or char_length(p_password) > 128 then
    return json_build_object('code','invalid_input','error','密码格式不正确');
  end if;
  update public.app_users
     set password_salt = 'bf', password_hash = crypt(p_password, gen_salt('bf', 8)), updated_at = now()
   where id = v_me and password_salt <> 'bf';
  return json_build_object('ok', true);
end $$;

revoke all on function public.zsb_adopt_password(text,text) from public, anon, authenticated;
grant execute on function public.zsb_adopt_password(text,text) to anon, authenticated;

-- 主通道(Vercel)需要能校验直连通道写入的 bcrypt 摘要,否则同一账号换通道就登不上。
grant execute on function public.zsb_password_ok(text,text,text) to service_role;
grant execute on function public.zsb_session_user(text) to service_role;

-- 辅助函数不需要对外暴露:上面的 SECURITY DEFINER 函数以属主身份执行,
-- 内部调用不依赖调用者的权限。PostgreSQL 默认把 EXECUTE 授予 PUBLIC,这里收回。
revoke all on function public.zsb_token_hash(text) from public, anon, authenticated;
revoke all on function public.zsb_normalize_name(text) from public, anon, authenticated;
revoke all on function public.zsb_password_ok(text,text,text) from public, anon, authenticated;
grant execute on function public.zsb_password_ok(text,text,text) to service_role;
