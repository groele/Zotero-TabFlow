param([string]$OutputPath, [switch]$UpdateFeed, [switch]$VerifyOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $VerifyOnly) {
    Push-Location $projectRoot
    try {
        & npm run build:bundle
        if ($LASTEXITCODE -ne 0) { throw 'Type check or bundle failed' }
    } finally { Pop-Location }
}
$manifest = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'manifest.json') | ConvertFrom-Json
if (-not $OutputPath) { $OutputPath = Join-Path $projectRoot ('dist\Zotero-TabFlow-' + $manifest.version + '.xpi') }
$runtimeFiles = @('manifest.json','bootstrap.js','prefs.js','prefs.xhtml','settings.css','tabflow.svg','pdf-folder.svg','pdf-preview.svg','pdf-preview-sidenav.svg','pdf-preview-16.png','pdf-preview-20.png','pdf-preview-32.png','pdf-preview-64.png','zoterotabflow.js','zoterotabflow_prefs.js','LICENSE')
$entries = @($runtimeFiles | ForEach-Object {
    [PSCustomObject]@{ Source = Join-Path $projectRoot $_; Name = $_ }
})
$entries += @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'locale') -Recurse -File | Sort-Object FullName | ForEach-Object {
    [PSCustomObject]@{ Source = $_.FullName; Name = [IO.Path]::GetRelativePath($projectRoot, $_.FullName).Replace('\','/') }
})
foreach ($entry in $entries) { if (-not (Test-Path -LiteralPath $entry.Source -PathType Leaf)) { throw "Missing runtime file: $($entry.Name)" } }
$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
if (-not $VerifyOnly) {
    $distDir = Split-Path -Parent $resolvedOutput
    New-Item -ItemType Directory -Path $distDir -Force | Out-Null
    Get-ChildItem -LiteralPath $distDir -Filter 'Zotero-TabFlow-*.xpi' -File -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -ne $resolvedOutput } |
        Remove-Item -Force
    Add-Type -AssemblyName System.IO.Compression
    $stream = [IO.File]::Open($resolvedOutput, [IO.FileMode]::Create)
    $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($entry in $entries) {
            $zipEntry = $archive.CreateEntry($entry.Name, [IO.Compression.CompressionLevel]::Optimal)
            $zipEntry.LastWriteTime = [DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
            $inputStream = [IO.File]::OpenRead($entry.Source)
            $outputStream = $zipEntry.Open()
            try { $inputStream.CopyTo($outputStream) } finally { $inputStream.Dispose(); $outputStream.Dispose() }
        }
    } finally { $archive.Dispose(); $stream.Dispose() }
}
$hash = (Get-FileHash -LiteralPath $resolvedOutput -Algorithm SHA256).Hash
$hash512 = (Get-FileHash -LiteralPath $resolvedOutput -Algorithm SHA512).Hash
if ($UpdateFeed) {
    $feedPath = Join-Path $projectRoot 'update.json'
    $feed = Get-Content -LiteralPath $feedPath -Raw | ConvertFrom-Json
    $update = $feed.addons.($manifest.applications.zotero.id).updates[0]
    if ($update.version -ne $manifest.version) { throw 'Update feed version does not match manifest' }
    $update | Add-Member -NotePropertyName update_hash -NotePropertyValue ('sha512:' + $hash512.ToLowerInvariant()) -Force
    $feedText = ($feed | ConvertTo-Json -Depth 12).Replace("`r`n", "`n") + "`n"
    [IO.File]::WriteAllText($feedPath, $feedText, [Text.UTF8Encoding]::new($false))
}
[PSCustomObject]@{ Path = $resolvedOutput; Bytes = (Get-Item -LiteralPath $resolvedOutput).Length; SHA512 = $hash512; SHA256 = $hash; RuntimeFiles = $entries.Count } | Format-List
