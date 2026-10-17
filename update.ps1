[CmdletBinding()]
param(
    [ValidateSet('Lyrics', 'Theme', 'Both')][string]$Component = 'Theme',
    [switch]$EnableAutoUpdate,
    [switch]$DisableAutoUpdate,
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$taskName = "Spicetify Juxtaposed Updates ($Component)"
$stateRoot = Join-Path $env:LOCALAPPDATA 'SpicetifyJuxtaposedUpdater'
if ($DisableAutoUpdate) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output "Automatic updates disabled for $Component."
    return
}
if ($EnableAutoUpdate) {
    New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
    $installedScript = Join-Path $stateRoot 'update.ps1'
    if ([IO.Path]::GetFullPath($PSCommandPath) -ne [IO.Path]::GetFullPath($installedScript)) {
        Copy-Item -LiteralPath $PSCommandPath -Destination $installedScript -Force
    }
    $spicetifyExe = (Get-Command spicetify -ErrorAction Stop).Source
    Set-Content -LiteralPath (Join-Path $stateRoot 'spicetify-path.txt') -Value $spicetifyExe
    $arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$installedScript`" -Component $Component"
    $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument $arguments
    $trigger = New-ScheduledTaskTrigger -Daily -At '12:00'
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)
    $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
    Write-Output "Automatic updates enabled for ${Component}: daily at noon while signed in."
    return
}

$spicetifyCommand = Get-Command spicetify -ErrorAction SilentlyContinue
if ($spicetifyCommand) { $spicetifyExe = $spicetifyCommand.Source }
else { $spicetifyExe = Get-Content -LiteralPath (Join-Path $stateRoot 'spicetify-path.txt') }
if (-not (Test-Path -LiteralPath $spicetifyExe -PathType Leaf)) { throw 'Spicetify executable not found.' }
$configFile = (& $spicetifyExe -c | Select-Object -Last 1).Trim()
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $configFile)) { throw 'Cannot locate the Spicetify configuration.' }
$configRoot = Split-Path -Parent $configFile
$projects = @()
if ($Component -in @('Lyrics', 'Both')) {
    $projects += @{ Repo = 'spicetify-lyrics-plus-juxtaposed'; Folder = 'CustomApps\lyrics-plus'; Source = 'lyrics-plus'; Files = @() }
}
if ($Component -in @('Theme', 'Both')) {
    $projects += @{ Repo = 'spicetify-juxtaposed'; Folder = 'Themes\Juxtaposed'; Source = ''; Files = @('user.css', 'color.ini', 'theme.js') }
}
$headers = @{ 'User-Agent' = 'Juxtaposed-Updater'; Accept = 'application/vnd.github+json' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
$changed = @()
try {
    foreach ($project in $projects) {
        $destination = Join-Path $configRoot $project.Folder
        if (-not (Test-Path -LiteralPath $destination -PathType Container)) {
            Write-Output "$($project.Repo): not installed manually; skipping."
            continue
        }
        $repo = $project.Repo
        # Resolve a published release to an immutable commit, including annotated tags.
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/superC12/$repo/releases/latest" -Headers $headers -TimeoutSec 30
        $tag = [Uri]::EscapeDataString($release.tag_name)
        $commit = Invoke-RestMethod -Uri "https://api.github.com/repos/superC12/$repo/commits/$tag" -Headers $headers -TimeoutSec 30
        $sha = $commit.sha
        if ($sha -notmatch '^[a-f0-9]{40}$') { throw 'Invalid release commit.' }
        $stamp = Join-Path $destination '.juxtaposed-update-sha'
        if ((Test-Path -LiteralPath $stamp) -and (Get-Content -LiteralPath $stamp -Raw).Trim() -eq $sha) {
            Write-Output "$repo is up to date ($($release.tag_name))."
            continue
        }
        Write-Output "$repo has an update: $($release.tag_name)."
        if ($CheckOnly) { continue }
        $temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) ('juxtaposed-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
        New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
        # Record exact paths before mutation; preserve backups if applying fails.
        $archive = Join-Path $temporaryRoot 'release.zip'
        Invoke-WebRequest -Uri "https://codeload.github.com/superC12/$repo/zip/$sha" -OutFile $archive -UseBasicParsing -TimeoutSec 120
        Expand-Archive -LiteralPath $archive -DestinationPath (Join-Path $temporaryRoot 'source')
        $source = Join-Path (Join-Path $temporaryRoot "source\$repo-$sha") $project.Source
        $files = if ($project.Files.Count) { $project.Files } else {
            @('index.js', 'manifest.json', 'style.css') + @((Get-Content -LiteralPath (Join-Path $source 'manifest.json') -Raw | ConvertFrom-Json).subfiles) + @((Get-Content -LiteralPath (Join-Path $source 'manifest.json') -Raw | ConvertFrom-Json).subfiles_extension)
        }
        foreach ($file in $files) {
            if ($file -notmatch '^[A-Za-z0-9_.-]+\.(js|json|css|ini)$' -or -not (Test-Path -LiteralPath (Join-Path $source $file) -PathType Leaf)) {
                throw "Invalid or missing release file: $file"
            }
        }
        $backup = Join-Path $temporaryRoot 'backup'
        New-Item -ItemType Directory -Path $backup | Out-Null
        $record = @{ Destination = $destination; Backup = $backup; Files = $files; Existing = @(); Stamp = $stamp; Sha = $sha }
        foreach ($file in $files) {
            $target = Join-Path $destination $file
            if (Test-Path -LiteralPath $target) {
                Copy-Item -LiteralPath $target -Destination (Join-Path $backup $file)
                $record.Existing += $file
            }
        }
        $changed += $record
        foreach ($file in $files) { Copy-Item -LiteralPath (Join-Path $source $file) -Destination (Join-Path $destination $file) -Force }
    }
    if ($changed.Count) {
        & $spicetifyExe apply
        if ($LASTEXITCODE -ne 0) { throw 'Spicetify apply failed.' }
        foreach ($record in $changed) { Set-Content -LiteralPath $record.Stamp -Value $record.Sha }
        Write-Output 'Updates applied. Spotify may reload.'
    }
} catch {
    foreach ($record in $changed) {
        foreach ($file in $record.Files) {
            $target = Join-Path $record.Destination $file
            if ($file -in $record.Existing) { Copy-Item -LiteralPath (Join-Path $record.Backup $file) -Destination $target -Force }
            elseif (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target }
        }
    }
    Add-Content -LiteralPath (Join-Path $stateRoot 'errors.log') -Value ('{0}: {1}' -f (Get-Date -Format o), $_.Exception.Message)
    if ($changed.Count) { Write-Warning 'Original source files restored. Run spicetify apply to restore the previous running build.' }
    throw
}
