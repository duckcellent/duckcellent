# Builds index.html from src/template_saas.html (same as tools/build.py, for Windows without Python).
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File tools/build.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$rd = { param($p) [IO.File]::ReadAllText((Join-Path $root $p), [Text.Encoding]::UTF8) }
$s = & $rd 'src/template_saas.html'
foreach ($k in @(@('COUNTRIES', 'countries.js'), @('MAPDATA', 'mapdata.js'), @('AIRPORTS', 'airports.js'))) {
  $s = $s.Replace('/*@' + $k[0] + '@*/', (& $rd ('src/' + $k[1])))
}
$out = Join-Path $root 'index.html'
[IO.File]::WriteAllText($out, (& $rd 'tools/page_head.html') + $s + "`n" + (& $rd 'tools/page_tail.html'), (New-Object Text.UTF8Encoding $false))
"index.html $((Get-Item $out).Length)"
