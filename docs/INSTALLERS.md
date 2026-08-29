# Android and Windows installers

The web app links to the latest GitHub Release assets:

- `ZSB-Study-Helper.apk` for Android phones.
- `ZSB-Study-Helper-Setup.exe` for 64-bit Windows PCs.

The Android package ID and the Windows application ID are both permanent: `com.gitubcreater.zsbstudyhelper`. A newer APK replaces an installed APK only when it is signed by the same Android key. The Windows installer keeps the same application ID and replaces the older installed desktop app.

## First Android release

Create one Android signing key and keep its `.jks` file and passwords in a secure backup. Do not create a new key for later releases.

```powershell
keytool -genkeypair -v -keystore zsb-study-helper-upload.jks -alias zsb-study-helper -keyalg RSA -keysize 4096 -validity 10000
[Convert]::ToBase64String([IO.File]::ReadAllBytes('zsb-study-helper-upload.jks')) | Set-Clipboard
```

In the GitHub repository, open **Settings -> Secrets and variables -> Actions** and add these repository secrets:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | Base64 value copied by the second command |
| `ANDROID_STORE_PASSWORD` | Password chosen for the `.jks` file |
| `ANDROID_KEY_ALIAS` | `zsb-study-helper` (or the alias chosen above) |
| `ANDROID_KEY_PASSWORD` | Password for the key alias |

## Publish a new installer

Push the source code, then push a version tag. The GitHub Actions workflow builds the signed APK and Windows installer, creates a GitHub Release, and publishes the files under stable download names.

```powershell
git tag v1.0.1
git push origin main --tags
```

Use a higher version tag for every release. The desktop app checks GitHub Releases at startup and asks to install any newer version. Android requires the phone owner to confirm installation; Android does not permit webpages or apps to silently install or replace another app.

For a local Android test APK, install **Android SDK Platform 36** in Android Studio, then run `npm run android:apk`. The command automatically uses Android Studio's bundled Java when `JAVA_HOME` is not set. For a local Windows installer, run `npm run desktop:installer`.
