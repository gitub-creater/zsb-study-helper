-- Migration: Email verification code system
-- Run this in Supabase SQL Editor after add_email_support.sql

-- 1. 创建验证码表
create table if not exists public.email_verification_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used boolean not null default false,
  ip_address text,
  constraint email_format_check check (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$')
);

-- 索引优化
create index if not exists idx_email_codes_lookup 
  on email_verification_codes(email, code, expires_at) 
  where not used;

create index if not exists idx_email_codes_cleanup 
  on email_verification_codes(expires_at);

-- 2. 定时清理过期验证码函数
create or replace function public.cleanup_expired_codes()
returns void as \$\$
begin
  delete from email_verification_codes
  where expires_at < now() - interval '1 day';
end;
\$\$ language plpgsql security definer;

-- 3. 发送验证码 RPC（记录请求，由 API 层实际发送邮件）
create or replace function public.send_verification_code(
  p_email text,
  p_code text,
  p_ip text default null
) returns jsonb as \$\$
declare
  v_last_sent timestamptz;
  v_wait_seconds int;
begin
  -- 验证邮箱格式
  if p_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$' then
    return jsonb_build_object(
      'success', false,
      'error', '邮箱格式不正确'
    );
  end if;

  -- 检查 60 秒发送限制
  select created_at into v_last_sent
  from email_verification_codes
  where email = p_email
  order by created_at desc
  limit 1;
  
  if v_last_sent is not null and v_last_sent > now() - interval '60 seconds' then
    v_wait_seconds := 60 - extract(epoch from now() - v_last_sent)::int;
    return jsonb_build_object(
      'success', false,
      'error', '请等待 ' || v_wait_seconds || ' 秒后再试',
      'waitSeconds', v_wait_seconds
    );
  end if;
  
  -- 插入验证码记录
  insert into email_verification_codes (email, code, expires_at, ip_address)
  values (p_email, p_code, now() + interval '10 minutes', p_ip);
  
  return jsonb_build_object(
    'success', true, 
    'expiresIn', 600
  );
end;
\$\$ language plpgsql security definer;

-- 4. 验证邮箱验证码并登录/注册
create or replace function public.verify_email_code(
  p_email text,
  p_code text
) returns jsonb as \$\$
declare
  v_code_record record;
  v_user_id uuid;
  v_user_name text;
  v_session_token text;
  v_is_new_user boolean;
  v_random_suffix text;
begin
  -- 查找有效验证码
  select * into v_code_record
  from email_verification_codes
  where email = p_email
    and code = p_code
    and not used
    and expires_at > now()
  order by created_at desc
  limit 1;
  
  if not found then
    return jsonb_build_object(
      'success', false,
      'error', '验证码错误或已过期'
    );
  end if;
  
  -- 标记验证码已使用
  update email_verification_codes
  set used = true
  where id = v_code_record.id;
  
  -- 查找或创建用户
  select id, name into v_user_id, v_user_name
  from app_users
  where email = p_email;
  
  if not found then
    -- 自动注册新用户，生成随机昵称
    v_user_id := gen_random_uuid();
    v_random_suffix := lpad(floor(random() * 10000)::text, 4, '0');
    v_user_name := '用户' || v_random_suffix;
    v_is_new_user := true;
    
    insert into app_users (id, name, email, created_at)
    values (v_user_id, v_user_name, p_email, now());
  else
    v_is_new_user := false;
  end if;
  
  -- 创建会话令牌
  v_session_token := encode(gen_random_bytes(32), 'base64');
  
  insert into app_sessions (user_id, token, expires_at)
  values (v_user_id, v_session_token, now() + interval '90 days');
  
  return jsonb_build_object(
    'success', true,
    'user', jsonb_build_object(
      'id', v_user_id, 
      'name', v_user_name
    ),
    'session', jsonb_build_object(
      'token', v_session_token
    ),
    'isNewUser', v_is_new_user
  );
end;
\$\$ language plpgsql security definer;

-- 5. 授权匿名用户调用这些函数
grant execute on function public.send_verification_code to anon, authenticated;
grant execute on function public.verify_email_code to anon, authenticated;
grant execute on function public.cleanup_expired_codes to anon, authenticated;

-- 6. 设置 RLS 策略（验证码表只能通过 RPC 访问）
alter table public.email_verification_codes enable row level security;

create policy "Codes only accessible via RPC"
  on public.email_verification_codes
  for all
  using (false);

