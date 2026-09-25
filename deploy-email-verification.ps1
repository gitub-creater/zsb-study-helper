# 邮箱验证码登录 - 自动部署脚本
# 用途: 一键完成前端构建和 Vercel 部署

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  专升本学习助手 - 邮箱验证码登录部署" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 检查是否在项目目录
$projectPath = "C:\Users\丁辉\zsb-study-helper"
if (-not (Test-Path "$projectPath\package.json")) {
    Write-Host "❌ 错误: 项目目录不存在或不是 Node.js 项目" -ForegroundColor Red
    Write-Host "   预期路径: $projectPath" -ForegroundColor Yellow
    exit 1
}

Set-Location $projectPath

# 步骤 1: 检查 Vercel CLI
Write-Host "[1/6] 检查 Vercel CLI..." -ForegroundColor Yellow
try {
    $vercelVersion = vercel --version 2>&1
    Write-Host "✓ Vercel CLI 已安装: $vercelVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Vercel CLI 未安装" -ForegroundColor Red
    Write-Host "   请运行: npm install -g vercel" -ForegroundColor Yellow
    exit 1
}

# 步骤 2: 检查依赖
Write-Host "
[2/6] 检查项目依赖..." -ForegroundColor Yellow
if (-not (Test-Path "node_modules")) {
    Write-Host "⚠ 依赖未安装，正在安装..." -ForegroundColor Yellow
    npm install --include=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ 依赖安装失败" -ForegroundColor Red
        exit 1
    }
}
Write-Host "✓ 依赖检查完成" -ForegroundColor Green

# 步骤 3: 检查 Resend SDK
Write-Host "
[3/6] 检查邮件服务 SDK..." -ForegroundColor Yellow
$packageJson = Get-Content "package.json" | ConvertFrom-Json
if ($packageJson.dependencies.resend -or $packageJson.devDependencies.resend) {
    Write-Host "✓ Resend SDK 已安装" -ForegroundColor Green
} else {
    Write-Host "❌ 缺少 Resend SDK" -ForegroundColor Red
    Write-Host "   正在安装..." -ForegroundColor Yellow
    npm install resend
}

# 步骤 4: 前端构建
Write-Host "
[4/6] 构建前端..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 前端构建失败" -ForegroundColor Red
    exit 1
}
Write-Host "✓ 前端构建成功" -ForegroundColor Green

# 步骤 5: 部署到 Vercel
Write-Host "
[5/6] 部署到 Vercel..." -ForegroundColor Yellow
Write-Host "   这可能需要 1-2 分钟..." -ForegroundColor Gray

vercel --prod --yes

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Vercel 部署失败" -ForegroundColor Red
    exit 1
}

# 步骤 6: 获取部署 URL
Write-Host "
[6/6] 获取部署信息..." -ForegroundColor Yellow
$deploymentInfo = vercel ls zsb-study-helper --meta 1 2>&1 | Out-String

if ($deploymentInfo -match "https://[a-z0-9-]+\.vercel\.app") {
    $deployUrl = $matches[0]
    Write-Host "✓ 部署成功！" -ForegroundColor Green
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  部署完成" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "访问地址: $deployUrl" -ForegroundColor White
    Write-Host ""
    Write-Host "⚠ 国内访问提示:" -ForegroundColor Yellow
    Write-Host "   *.vercel.app 在国内可能无法访问" -ForegroundColor Gray
    Write-Host "   建议绑定自定义域名" -ForegroundColor Gray
    Write-Host ""
    Write-Host "下一步:" -ForegroundColor Cyan
    Write-Host "  1. 确认已执行 Supabase 数据库迁移" -ForegroundColor White
    Write-Host "  2. 在 Vercel 配置环境变量:" -ForegroundColor White
    Write-Host "     - RESEND_API_KEY" -ForegroundColor Gray
    Write-Host "     - EMAIL_FROM" -ForegroundColor Gray
    Write-Host "     - EMAIL_FROM_NAME" -ForegroundColor Gray
    Write-Host "  3. 运行测试脚本验证功能" -ForegroundColor White
    Write-Host ""
} else {
    Write-Host "⚠ 部署可能成功，但无法获取 URL" -ForegroundColor Yellow
    Write-Host "   请访问 Vercel Dashboard 查看" -ForegroundColor Gray
}

Write-Host "按任意键退出..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
