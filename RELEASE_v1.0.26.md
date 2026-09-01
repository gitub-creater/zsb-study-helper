# 专升本学习助手 v1.0.26 更新说明

## ✨ 新功能

### 📢 AI 数字讲题语音功能上线

**全平台语音支持**：Web 端、Android 应用、桌面应用现已支持语音输入和语音播报！

- **🎤 语音输入**：点击输入框左侧麦克风按钮，说出题目内容，自动识别为文字
- **🔊 语音播报**：AI 解答完成后，点击「朗读答案」按钮，AI 以自然语音读出解题步骤
- **智能适配**：自动检测浏览器支持情况，不支持的环境自动隐藏语音按钮
- **移动端优化**：增大触摸区域（44px），录音时脉冲动画提示

### 技术实现

- 基于浏览器原生 Web Speech API（无需第三方服务）
- TTS（Text-to-Speech）：`speechSynthesis` 语音合成
- ASR（Automatic Speech Recognition）：`SpeechRecognition` 语音识别
- 自动选择中文语音，支持语速/音调调节
- Android 应用已添加麦克风权限（`RECORD_AUDIO`）

## 🔧 修复

- **Android 应用语音权限**：在 `AndroidManifest.xml` 中添加 `RECORD_AUDIO` 权限，解决移动端语音识别无法使用的问题
- **移动端兼容性检测**：增加浏览器支持检测，友好提示不支持的环境

## 🌐 浏览器兼容性

### ✅ 完全支持（语音输入 + 语音播报）
- Android Chrome/Edge
- iOS Safari 14.5+
- Windows/macOS Chrome/Edge
- macOS Safari

### ⚠️ 部分支持（仅语音播报）
- Firefox（所有平台）
- 部分国产浏览器（百度、UC、QQ 浏览器）

### ❌ 不支持
- iOS Safari 14.5 以下版本
- 微信内置浏览器

## 📦 安装方式

### 在线使用（推荐）
- **GitHub Pages**：https://gitub-creater.github.io/zsb-study-helper/
- **Vercel 加速**：https://shandong-zsb-study-helper.vercel.app/

### Android 应用
1. 下载 APK：[zsb-study-helper-v1.0.26.apk](https://github.com/gitub-creater/zsb-study-helper/releases/download/v1.0.26/zsb-study-helper-v1.0.26.apk)
2. 安装后首次使用需授权麦克风权限（语音输入必需）

### Windows 桌面应用
1. 下载安装包：[zsb-study-helper-setup-1.0.26.exe](https://github.com/gitub-creater/zsb-study-helper/releases/download/v1.0.26/zsb-study-helper-setup-1.0.26.exe)
2. 运行安装程序，按提示完成安装

## 🔨 手动构建（开发者）

### Android APK
```bash
# 安装依赖
npm install

# 同步到 Android
npm run android:sync

# 构建 Debug 版本
npm run android:apk

# 构建 Release 版本（需要签名配置）
npm run android:release
```

### Windows 桌面应用
```bash
# 安装依赖
npm install

# 构建安装包
npm run desktop:installer
```

## 📝 使用说明

### 语音输入步骤
1. 进入「AI 数学讲题」页面
2. 点击输入框左侧 🎤 麦克风按钮
3. 首次使用需授权麦克风权限
4. 对着设备说出题目内容
5. 识别完成后自动填入输入框
6. 点击「发送」或继续补充内容

### 语音播报步骤
1. 发送题目后等待 AI 解答
2. 解答完成后，点击答案下方「🔊 朗读答案」按钮
3. AI 开始朗读解题步骤
4. 再次点击按钮可停止播报

## 🙏 致谢

感谢所有用户的反馈和建议！

---

**开发者**：丁辉  
**项目地址**：https://github.com/gitub-creater/zsb-study-helper  
**反馈问题**：https://github.com/gitub-creater/zsb-study-helper/issues
