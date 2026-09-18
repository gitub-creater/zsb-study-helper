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

-- 只暴露这几个函数;app_users/app_sessions/user_states 的 RLS 仍然拦住 anon 直接读写。
revoke all on function public.zsb_register(text,text,text) from public, anon, authenticated;
revoke all on function public.zsb_register(text,text,text,text) from public, anon, authenticated;
revoke all on function public.zsb_login(text,text) from public, anon, authenticated;
revoke all on function public.zsb_find_users(text,text) from public, anon, authenticated;
revoke all on function public.zsb_get_state(text) from public, anon, authenticated;
revoke all on function public.zsb_put_state(text,jsonb) from public, anon, authenticated;
revoke all on function public.zsb_set_bf_password(text,text) from public, anon, authenticated;
revoke all on function public.zsb_session_user(text) from public, anon, authenticated;

grant execute on function public.zsb_register(text,text,text) to anon, authenticated;
grant execute on function public.zsb_register(text,text,text,text) to anon, authenticated;
grant execute on function public.zsb_login(text,text) to anon, authenticated;
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
