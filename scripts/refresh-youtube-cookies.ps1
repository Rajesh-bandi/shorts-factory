#requires -Version 5.1
<#
Refresh the YouTube cookies used by Shorts Factory on EC2.

YouTube blocks live streams from datacenter IPs unless the request carries a
signed-in session. This script exports a *complete* Netscape cookie file from a
local browser, verifies it from EC2, and installs it at
/opt/shorts/data/secrets/youtube-cookies.txt.

The browser must be signed in to YouTube. Use a dedicated Google account for
this, not your main account: automated downloads can get an account limited.

Usage:
  powershell -ExecutionPolicy Bypass -File scripts/refresh-youtube-cookies.ps1
  powershell -ExecutionPolicy Bypass -File scripts/refresh-youtube-cookies.ps1 -Browser "firefox:default-release"
#>
[CmdletBinding()]
param(
    [string]$Browser = "firefox",
    [string]$SshHost = "ubuntu@52.207.181.21",
    [string]$KeyPath = (Join-Path $env:USERPROFILE ".ssh\shorts-deploy.pem"),
    [string]$TestUrl = "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    [switch]$SkipRemoteTest
)

$ErrorActionPreference = "Stop"

function Find-YtDlp {
    $exe = Get-Command yt-dlp -ErrorAction SilentlyContinue
    if ($exe) { return @($exe.Source) }
    # Native stderr becomes a terminating error under ErrorActionPreference=Stop,
    # and probing a Python that lacks yt-dlp is expected to fail.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        foreach ($python in @("py", "python")) {
            $cmd = Get-Command $python -ErrorAction SilentlyContinue
            if (-not $cmd) { continue }
            $probe = if ($python -eq "py") { @("-3", "-m", "yt_dlp", "--version") } else { @("-m", "yt_dlp", "--version") }
            & $cmd.Source @probe *> $null
            if ($LASTEXITCODE -eq 0) {
                if ($python -eq "py") { return @($cmd.Source, "-3", "-m", "yt_dlp") }
                return @($cmd.Source, "-m", "yt_dlp")
            }
        }
    } finally {
        $ErrorActionPreference = $previous
    }
    throw "yt-dlp is not installed. Run: py -3 -m pip install -U `"yt-dlp[default]`""
}

$ytdlp = Find-YtDlp
$exe = $ytdlp[0]
$prefix = @()
if ($ytdlp.Length -gt 1) { $prefix = $ytdlp[1..($ytdlp.Length - 1)] }

$raw = Join-Path $env:TEMP "shorts-youtube-cookies-raw.txt"
$filtered = Join-Path $env:TEMP "shorts-youtube-cookies.txt"
Remove-Item $raw, $filtered -ErrorAction SilentlyContinue

Write-Host "Exporting cookies from $Browser ..."
$exportArgs = $prefix + @(
    "--cookies-from-browser", $Browser,
    "--cookies", $raw,
    "--simulate", "--no-warnings", $TestUrl
)
& $exe @exportArgs
$exportExit = $LASTEXITCODE
# A local "Requested format is not available" is expected on machines without
# Deno/PO tokens; yt-dlp still writes the cookie jar. The EC2 test below is the
# authoritative check, so only a missing file means the browser export failed.
if (-not (Test-Path $raw)) {
    throw "Could not read cookies from $Browser (yt-dlp exit $exportExit). Is it installed and signed in to YouTube?"
}
if ($exportExit -ne 0) {
    Write-Host "Local format probe failed (exit $exportExit); continuing, EC2 will test the cookies."
}

$lines = Get-Content $raw | Where-Object { $_ -match '^#' -or $_ -match 'youtube\.com' }
$content = ($lines -join "`n") + "`n"
[IO.File]::WriteAllText($filtered, $content, [Text.Encoding]::ASCII)

$names = @(
    $lines |
        ForEach-Object { $_ -replace '^#HttpOnly_', '' } |
        Where-Object { $_ -notmatch '^#' -and $_ -match 'youtube\.com' } |
        ForEach-Object { ($_ -split "`t")[5] } |
        Where-Object { $_ }
)
$hasLogin = $names -contains "LOGIN_INFO"
$hasSid = ($names -contains "SID") -or ($names -contains "__Secure-1PSID") -or ($names -contains "__Secure-3PSID")
if (-not ($hasLogin -and $hasSid)) {
    throw "The export is incomplete (missing LOGIN_INFO or SID). Sign in to YouTube in $Browser, open any video, then run this again."
}
Write-Host "Exported $($names.Count) YouTube cookies."

Write-Host "Uploading to $SshHost ..."
& scp -i $KeyPath $filtered "${SshHost}:/tmp/shorts-youtube-cookies.txt"
if ($LASTEXITCODE -ne 0) {
    throw "scp failed. Check the SSH key, the host, and the security-group rule for your current IP."
}

if (-not $SkipRemoteTest) {
    Write-Host "Testing the cookies from EC2 ..."
    $remoteTest = @'
cd ~/yt-short-maker || exit 1
docker compose -f docker-compose.aws.yml cp /tmp/shorts-youtube-cookies.txt backend:/tmp/new-cookies.txt
docker compose -f docker-compose.aws.yml exec -T backend sh -c 'cp /tmp/new-cookies.txt /tmp/test-cookies.txt && chmod 600 /tmp/test-cookies.txt && yt-dlp --cookies /tmp/test-cookies.txt --simulate --no-warnings "https://www.youtube.com/watch?v=dQw4w9WgXcQ"'
'@
    & ssh -i $KeyPath $SshHost $remoteTest
    if ($LASTEXITCODE -ne 0) {
        throw "EC2 rejected the cookies. The old file was left in place."
    }
}

Write-Host "Installing ..."
$remoteInstall = @'
install -D -m 600 /tmp/shorts-youtube-cookies.txt /opt/shorts/data/secrets/youtube-cookies.txt
rm -f /tmp/shorts-youtube-cookies.txt
cd ~/yt-short-maker || exit 1
docker compose -f docker-compose.aws.yml exec -T -u root backend rm -f /tmp/new-cookies.txt /tmp/test-cookies.txt /data/.cache/youtube-cookies.txt
'@
& ssh -i $KeyPath $SshHost $remoteInstall
if ($LASTEXITCODE -ne 0) { throw "Install failed." }

Remove-Item $raw, $filtered -ErrorAction SilentlyContinue
Write-Host "Done. YouTube cookies refreshed."
