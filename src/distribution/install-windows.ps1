param([int]$ParentId, [string]$Installer, [string]$Target, [string]$Executable,
      [string]$Digest, [long]$Size, [string]$Job, [string]$Result, [string]$Version)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Save-Result([string]$Status) {
    [IO.File]::WriteAllText($Result, (@{version=$Version;status=$Status;job=[IO.Path]::GetFileName($Job)} | ConvertTo-Json -Compress), $utf8)
}
[IO.File]::WriteAllText((Join-Path $Job 'ready'), '', $utf8)
$committed = $false
$backup = Join-Path $Job 'previous'
$backedUp = $false
try {
    for ($attempt = 0; $attempt -lt 240; $attempt++) {
        if (Test-Path -LiteralPath (Join-Path $Job 'cancel')) { exit 0 }
        $alive = Get-Process -Id $ParentId -ErrorAction SilentlyContinue
        if (-not $alive -and (Test-Path -LiteralPath (Join-Path $Job 'commit'))) { $committed = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $committed) { Save-Result 'timeout'; exit 1 }
    if ((Get-Item -LiteralPath $Installer).Length -ne $Size -or
        (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Digest) {
        throw 'Installer verification failed'
    }
    $installDirectory = [IO.Path]::GetDirectoryName($Target)
    Copy-Item -LiteralPath $installDirectory -Destination $backup -Recurse
    $backedUp = $true
    # /D 必须是最后一个 NSIS 参数。安装到原目录，保留所有用户数据；由助手负责重新打开。
    $installArgs = '/S --updated /D=' + $installDirectory
    $process = Start-Process -FilePath $Installer -ArgumentList $installArgs -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw ('Installer exit: ' + $process.ExitCode) }
    Save-Result 'success'
} catch {
    [Console]::Error.WriteLine($_.Exception.ToString())
    if ($backedUp) {
        # 安装器可能已卸载旧文件；恢复应用文件，用户数据始终位于独立目录。
        New-Item -ItemType Directory -Path $installDirectory -Force | Out-Null
        Get-ChildItem -LiteralPath $backup -Force | Copy-Item -Destination $installDirectory -Recurse -Force
    }
    Save-Result 'error'
} finally {
    if ($committed -and (Test-Path -LiteralPath $Executable)) {
        Start-Process -FilePath $Executable -WorkingDirectory ([IO.Path]::GetDirectoryName($Executable))
    }
}
