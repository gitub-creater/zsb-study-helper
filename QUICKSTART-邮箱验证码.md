# 邮箱验证码登录系统 - 快速参考

## 🎯 核心改动

### 登录方式变更
- ❌ **移除**: 账号密码登录
- ✅ **新增**: 邮箱验证码登录
- ✅ **保留**: 游客快速体验

### 用户体验
- 首次使用邮箱 → 自动注册新账号
- 已注册邮箱 → 直接登录
- 验证码有效期: 10 分钟
- 防刷限制: 60 秒/次

---

## 📁 修改的文件

### 前端 (Frontend)
`
src/pages/LoginPage.tsx          # 完全重写 - 邮箱验证码界面
src/services/cloud.ts            # 新增 2 个函数
  - sendVerificationCode()
  - loginWithVerificationCode()
`

### API (Backend)
`
api/auth/send-code.ts            # 发送验证码
api/auth/verify-code.ts          # 验证登录
`

### 数据库 (Database)
`
supabase/migrations/email-verification-migration.sql
  - 新增表: email_verification_codes
  - 新增列: app_users.email
`

### 配置 (Config)
`
.env.example                     # 新增邮件配置示例
`

---

## 🚀 最快 5 分钟部署

### 第 1 步: 执行数据库迁移 (2 分钟)
1. 打开 https://supabase.com/dashboard
2. SQL Editor → New query
3. 复制粘贴 \supabase/migrations/email-verification-migration.sql\
4. 点击 Run

### 第 2 步: 配置邮件服务 (2 分钟)
1. 注册 https://resend.com (免费 3000 封/月)
2. 获取 API Key (Dashboard → API Keys)
3. Vercel 环境变量添加:
   `
   RESEND_API_KEY=re_xxxxx
   EMAIL_FROM=noreply@yourdomain.com
   EMAIL_FROM_NAME=专升本学习助手
   `

### 第 3 步: 部署代码 (1 分钟)
`powershell
cd C:\Users\丁辉\zsb-study-helper
.\deploy-email-verification.ps1
`

✅ 完成！

---

## 🧪 测试命令

### 本地测试
`powershell
.\test-email-verification.ps1
`

### 手动测试 API
`powershell
# 发送验证码
Invoke-RestMethod -Uri "https://your-domain.vercel.app/api/auth/send-code" 
  -Method POST 
  -ContentType "application/json" 
  -Body '{"email":"test@example.com"}'

# 验证登录
Invoke-RestMethod -Uri "https://your-domain.vercel.app/api/auth/verify-code" 
  -Method POST 
  -ContentType "application/json" 
  -Body '{"email":"test@example.com","code":"123456"}'
`

---

## 🛠️ 环境变量速查

### Vercel 必需配置
| 变量名 | 说明 | 示例 |
|--------|------|------|
| \RESEND_API_KEY\ | Resend API 密钥 | \e_xxxxx\ |
| \EMAIL_FROM\ | 发件邮箱 | \
oreply@yourdomain.com\ |
| \EMAIL_FROM_NAME\ | 发件人名称 | \专升本学习助手\ |
| \SUPABASE_URL\ | Supabase 地址 | \https://xxx.supabase.co\ |
| \SUPABASE_SERVICE_ROLE_KEY\ | Supabase 服务密钥 | \yJxxx...\ |

### 前端环境变量 (.env.production)
| 变量名 | 说明 |
|--------|------|
| \VITE_CLOUD_API_URL\ | API 地址 (自定义域名) |

---

## 🔗 快速链接

| 服务 | 链接 | 用途 |
|------|------|------|
| Vercel | https://vercel.com/dashboard | 部署管理 |
| Supabase | https://supabase.com/dashboard | 数据库管理 |
| Resend | https://resend.com/emails | 邮件发送记录 |

---

## ❓ 常见问题

### Q1: 收不到验证码邮件？
**A**: 检查垃圾邮件文件夹，或查看 Resend 发送记录

### Q2: 国内无法访问？
**A**: 配置自定义备案域名，\*.vercel.app\ 在国内被墙

### Q3: API 返回 404？
**A**: 确认 Vercel 部署完成，检查环境变量是否配置

### Q4: 验证码无效？
**A**: 验证码 10 分钟过期，或已被使用，请重新获取

### Q5: 频繁发送被限制？
**A**: 正常保护机制，60 秒后可重新发送

---

## 📞 需要帮助？

详细文档: \docs/邮箱验证码登录-完整部署指南.md\

---

**版本**: v2.0 邮箱验证码登录  
**更新**: 2026-09-19
