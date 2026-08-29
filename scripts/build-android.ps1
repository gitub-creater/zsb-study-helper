param(
  [ValidateSet('Debug', 'Release')]
  [string]$Configuration = 'Debug'
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$androidRoot = Join-Path $projectRoot 'android'
$studioJbr = 'C:\Program Files\Android\Android Studio\jbr'
$defaultSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'

if (-not $env:JAVA_HOME -and (Test-Path (Join-Path $studioJbr 'bin\java.exe'))) {
  $env:JAVA_HOME = $studioJbr
}

if (-not $env:JAVA_HOME -or -not (Test-Path (Join-Path $env:JAVA_HOME 'bin\java.exe'))) {
  throw 'Java 21 is required. Install Android Studio or set JAVA_HOME to a Java 21 installation.'
}

if (-not $env:ANDROID_HOME -and (Test-Path $defaultSdk)) {
  $env:ANDROID_HOME = $defaultSdk
}

if (-not $env:ANDROID_HOME -and -not (Test-Path (Join-Path $androidRoot 'local.properties'))) {
  throw 'Android SDK was not found. In Android Studio install Android SDK Platform 36, then set ANDROID_HOME or open the android folder once.'
}

Push-Location $projectRoot
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  & (Join-Path $projectRoot 'node_modules\.bin\cap.cmd') sync android
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

  Push-Location $androidRoot
  try {
    & .\gradlew.bat "assemble$Configuration"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  } finally {
    Pop-Location
  }
} finally {
  Pop-Location
}
