$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Receive-Asset($Repo, $Release, $Name, $Target) {
    $details = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/$Release" -Headers @{'User-Agent'='Yesil-Video-Setup'}
    $asset = $details.assets | Where-Object name -EQ $Name | Select-Object -First 1
    if (!$asset -or $asset.digest -notmatch '^sha256:([a-f0-9]{64})$') {
        throw "Dosyanın SHA-256 özeti bulunamadı: $Name"
    }
    $expected = $Matches[1]
    Write-Host "İndiriliyor $Name"
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $Target -UseBasicParsing
    if ((Get-FileHash -LiteralPath $Target -Algorithm SHA256).Hash -ne $expected) {
        throw "Dosya doğrulanamadı: $Name"
    }
}

try {
    $arch = $env:PROCESSOR_ARCHITEW6432
    if (!$arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
    if ($arch -notin @('AMD64', 'ARM64')) { throw 'Windows x64 veya ARM64 gerekli.' }
    $arm = $arch -eq 'ARM64'
    $root = Join-Path $env:LOCALAPPDATA 'YesilVideo'
    $null = New-Item -ItemType Directory -Path $root -Force
    $stage = Join-Path $root ([guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $stage
    try {
        $yt = if ($arm) { 'yt-dlp_arm64.exe' } else { 'yt-dlp.exe' }
        $deno = if ($arm) { 'deno-aarch64-pc-windows-msvc.zip' } else { 'deno-x86_64-pc-windows-msvc.zip' }
        $ff = if ($arm) { 'ffmpeg-master-latest-winarm64-gpl.zip' } else { 'ffmpeg-master-latest-win64-gpl.zip' }
        Receive-Asset 'yt-dlp/yt-dlp' 'latest' $yt "$stage\yt-dlp.exe"
        Receive-Asset 'denoland/deno' 'latest' $deno "$stage\deno.zip"
        Receive-Asset 'yt-dlp/FFmpeg-Builds' 'tags/latest' $ff "$stage\ffmpeg.zip"
        Expand-Archive -LiteralPath "$stage\deno.zip" -DestinationPath "$stage\deno"
        Expand-Archive -LiteralPath "$stage\ffmpeg.zip" -DestinationPath "$stage\ffmpeg"
        $denoExe = Get-ChildItem "$stage\deno" -Filter deno.exe -Recurse | Select-Object -First 1
        $ffmpeg = Get-ChildItem "$stage\ffmpeg" -Filter ffmpeg.exe -Recurse | Select-Object -First 1
        $ffprobe = Get-ChildItem "$stage\ffmpeg" -Filter ffprobe.exe -Recurse | Select-Object -First 1
        $bin = Join-Path $root ('bin-' + [DateTime]::UtcNow.ToString('yyyyMMddHHmmssfff'))
        $null = New-Item -ItemType Directory -Path $bin
        Copy-Item -LiteralPath @("$stage\yt-dlp.exe", $denoExe.FullName, $ffmpeg.FullName, $ffprobe.FullName, "$PSScriptRoot\Downloader.exe") -Destination $bin
        $hostName = 'com.yesilvideo.downloader'
        $manifest = Join-Path $bin 'native-host.json'
        $data = @{
            name = $hostName
            description = 'Reva Video Downloader for Windows'
            path = (Join-Path $bin 'Downloader.exe')
            type = 'stdio'
            allowed_origins = @('chrome-extension://aodlcpjlojlfbkilmegjejjjknkdokbo/')
        } | ConvertTo-Json -Compress
        [IO.File]::WriteAllText($manifest, $data, [Text.UTF8Encoding]::new($false))
        foreach ($browser in @('BraveSoftware\Brave-Browser', 'Google\Chrome', 'Microsoft\Edge')) {
            $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey("Software\$browser\NativeMessagingHosts\$hostName")
            try { $key.SetValue('', $manifest) }
            finally { $key.Dispose() }
        }
    } finally {
        Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
    }
    Write-Host 'Yardımcı kuruldu. Şimdi Brave, Chrome veya Edge üzerinden eklenti klasörünü yükle.'
    exit 0
} catch {
    Write-Host ("Kurulum başarısız: " + $_.Exception.Message) -ForegroundColor Red
    exit 1
}

