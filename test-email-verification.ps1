# 邮箱验证码登录 - 功能测试脚本
# 用途: 测试 API 端点是否正常工作

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  邮箱验证码登录 - 功能测试" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 获取 API 地址
Write-Host "请输入 API 地址 (留空使用默认):" -ForegroundColor Yellow
Write-Host "默认: https://zsb-study-helper.vercel.app" -ForegroundColor Gray
$apiUrl = Read-Host "API 地址"
if ([string]::IsNullOrWhiteSpace($apiUrl)) {
    $apiUrl = "https://zsb-study-helper.vercel.app"
}
$apiUrl = $apiUrl.TrimEnd('/')

Write-Host "
使用 API: $apiUrl" -ForegroundColor Cyan
Write-Host ""

# 获取测试邮箱
Write-Host "请输入测试邮箱地址:" -ForegroundColor Yellow
$email = Read-Host "邮箱"
if ([string]::IsNullOrWhiteSpace($email)) {
    Write-Host "❌ 邮箱不能为空" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  测试 1: 发送验证码" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

try {
    $sendCodeUrl = "$apiUrl/api/auth/send-code"
    Write-Host "请求地址: $sendCodeUrl" -ForegroundColor Gray
    
    $body = @{
        email = $email
    } | ConvertTo-Json

    $response = Invoke-RestMethod 
        -Uri $sendCodeUrl 
        -Method POST 
        -ContentType "application/json" 
        -Body $body 
        -ErrorAction Stop

    if ($response.success) {
        Write-Host "✓ 验证码发送成功" -ForegroundColor Green
        Write-Host "  有效期: $($response.expiresIn) 秒" -ForegroundColor Gray
        Write-Host ""
        Write-Host "📧 请查收邮件中的验证码" -ForegroundColor Yellow
    } else {
        Write-Host "❌ 发送失败" -ForegroundColor Red
        Write-Host "  错误: $($response.error)" -ForegroundColor Gray
        exit 1
    }
} catch {
    Write-Host "❌ 请求失败" -ForegroundColor Red
    Write-Host "  错误: $_" -ForegroundColor Gray
    Write-Host ""
    Write-Host "可能的原因:" -ForegroundColor Yellow
    Write-Host "  1. API 端点未部署" -ForegroundColor Gray
    Write-Host "  2. 网络连接问题" -ForegroundColor Gray
    Write-Host "  3. Vercel 函数错误" -ForegroundColor Gray
    exit 1
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  测试 2: 验证登录" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "请输入收到的验证码 (6 位数字):" -ForegroundColor Yellow
$code = Read-Host "验证码"

if ([string]::IsNullOrWhiteSpace($code) -or $code -notmatch '^\d{6}$') {
    Write-Host "❌ 验证码格式错误" -ForegroundColor Red
    exit 1
}

try {
    $verifyCodeUrl = "$apiUrl/api/auth/verify-code"
    Write-Host "请求地址: $verifyCodeUrl" -ForegroundColor Gray
    
    $body = @{
        email = $email
        code = $code
    } | ConvertTo-Json

    $response = Invoke-RestMethod 
        -Uri $verifyCodeUrl 
        -Method POST 
        -ContentType "application/json" 
        -Body $body 
        -ErrorAction Stop

    if ($response.success) {
        Write-Host "✓ 验证成功" -ForegroundColor Green
        Write-Host ""
        Write-Host "用户信息:" -ForegroundColor Cyan
        Write-Host "  ID: $($response.user.id)" -ForegroundColor White
        Write-Host "  名称: $($response.user.name)" -ForegroundColor White
        if ($response.isNewUser) {
            Write-Host "  状态: 新注册用户" -ForegroundColor Yellow
        } else {
            Write-Host "  状态: 已有用户" -ForegroundColor Green
        }
        Write-Host ""
        Write-Host "会话信息:" -ForegroundColor Cyan
        Write-Host "  Token: $($response.session.token.Substring(0, 20))..." -ForegroundColor Gray
        Write-Host ""
        Write-Host "✅ 所有测试通过！" -ForegroundColor Green
    } else {
        Write-Host "❌ 验证失败" -ForegroundColor Red
        Write-Host "  错误: $($response.error)" -ForegroundColor Gray
    }
} catch {
    Write-Host "❌ 请求失败" -ForegroundColor Red
    Write-Host "  错误: $_" -ForegroundColor Gray
    Write-Host ""
    Write-Host "可能的原因:" -ForegroundColor Yellow
    Write-Host "  1. 验证码错误或已过期" -ForegroundColor Gray
    Write-Host "  2. 数据库未迁移" -ForegroundColor Gray
    Write-Host "  3. RPC 函数不存在" -ForegroundColor Gray
    exit 1
}

Write-Host ""
Write-Host "按任意键退出..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
