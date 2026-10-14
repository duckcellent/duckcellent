# Builds places-v1.json (states/provinces and cities for the atlas) from GeoNames data (CC BY 4.0).
# Shape: {"c":{"USA":{"s":[[name,lat,lon,pop],...],"p":[[name,stateIndex,lat,lon,geonameid,pop],...]}}}
# (pop in thousands; stateIndex -1 when unknown; cities biggest first).
# Download these from https://download.geonames.org/export/dump/ into one folder and unzip the two zips there:
#   cities15000.zip, cities1000.zip, admin1CodesASCII.txt, countryInfo.txt
# Then run from the project folder:   powershell -File tools/build_places.ps1 -Src <that folder>
# If the data changes, bump the file name (places-v2.json) in this script and in src/template_saas.html,
# because the service worker keeps the old file cached.
param([Parameter(Mandatory=$true)][string]$Src)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'places-v1.json'
$inv = [Globalization.CultureInfo]::InvariantCulture

# Countries the app knows about (ISO3 codes in src/countries.js).
$known = @{}
foreach ($m in [regex]::Matches([IO.File]::ReadAllText((Join-Path $root 'src/countries.js')), '([A-Z]{3}):')) { $known[$m.Groups[1].Value] = 1 }

# ISO2 -> ISO3
$iso = @{}
foreach ($ln in [IO.File]::ReadLines((Join-Path $Src 'countryInfo.txt'))) {
  if ($ln.StartsWith('#')) { continue }
  $q = $ln.Split("`t"); if ($q.Count -gt 1) { $iso[$q[0]] = $q[1] }
}

# State / province names, keyed "US.CA"
$adm = @{}
foreach ($ln in [IO.File]::ReadLines((Join-Path $Src 'admin1CodesASCII.txt'))) {
  $q = $ln.Split("`t"); if ($q.Count -gt 1) { $adm[$q[0]] = $q[1] }
}

# Centre of each state: the middle of the area covered by its towns of 1,000+ people (10th to 90th percentile,
# so a far-off island or one big city does not drag the pin away).
$acc = @{}
foreach ($ln in [IO.File]::ReadLines((Join-Path $Src 'cities1000.txt'))) {
  $q = $ln.Split("`t")
  $key = $q[8] + '.' + $q[10]
  if (-not $adm.ContainsKey($key)) { continue }
  $a = $acc[$key]; if (-not $a) { $a = @((New-Object System.Collections.Generic.List[double]), (New-Object System.Collections.Generic.List[double]), (New-Object 'double[]' 1)); $acc[$key] = $a }
  $a[0].Add([double]::Parse($q[4], $inv)); $a[1].Add([double]::Parse($q[5], $inv)); $a[2][0] += [double]$q[14]
}
# Population in thousands: search results that match equally well are ranked by it.
$K = { param($p) [int64][Math]::Round($p / 1000) }
function Mid($list) {
  $v = $list.ToArray(); [Array]::Sort($v); $n = $v.Length
  ($v[[int][Math]::Floor(($n - 1) * 0.1)] + $v[[int][Math]::Ceiling(($n - 1) * 0.9)]) / 2
}

$J = { param($s) '"' + $s.Replace('\', '\\').Replace('"', '\"') + '"' }
$F = { param($d) [Math]::Round($d, 2).ToString($inv) }

$Ctry = @{}
foreach ($key in $acc.Keys) {
  $cc = $iso[$key.Split('.')[0]]; if (-not $known[$cc]) { continue }
  $a = $acc[$key]
  # Longitudes are unwrapped around their circular mean so states across the 180° line (Alaska, Chukotka, Fiji) work.
  $sx = 0.0; $sy = 0.0; foreach ($d in $a[1]) { $sx += [Math]::Cos($d * [Math]::PI / 180); $sy += [Math]::Sin($d * [Math]::PI / 180) }
  $mean = [Math]::Atan2($sy, $sx) * 180 / [Math]::PI
  $lons = New-Object System.Collections.Generic.List[double]
  foreach ($d in $a[1]) { $u = $d - $mean; while ($u -gt 180) { $u -= 360 }; while ($u -lt -180) { $u += 360 }; $lons.Add($u) }
  $lon = (Mid $lons) + $mean; if ($lon -gt 180) { $lon -= 360 }; if ($lon -lt -180) { $lon += 360 }
  if (-not $Ctry[$cc]) { $Ctry[$cc] = @{ s = New-Object System.Collections.ArrayList; idx = @{}; p = New-Object System.Collections.ArrayList } }
  [void]$Ctry[$cc].s.Add(@($adm[$key], (Mid $a[0]), $lon, $key, (& $K $a[2][0])))
}
foreach ($cc in @($Ctry.Keys)) {
  $sorted = @($Ctry[$cc].s | Sort-Object { $_[0] })
  $Ctry[$cc].s = $sorted
  for ($i = 0; $i -lt $sorted.Count; $i++) { $Ctry[$cc].idx[$sorted[$i][3]] = $i }
}

# Cities: towns of 15,000+ people, biggest first. Neighbourhoods, city districts ("Paris 15 Vaugirard",
# "Zürich (Kreis 3)") and abandoned or historical places are left out.
$skip = @{ PPLX = 1; PPLH = 1; PPLQ = 1; PPLW = 1; PPLCH = 1 }
$cities = New-Object System.Collections.ArrayList
foreach ($ln in [IO.File]::ReadLines((Join-Path $Src 'cities15000.txt'))) {
  $q = $ln.Split("`t")
  if ($skip[$q[7]] -or $q[1] -match '^[^\d]+ \d{2}( |$)|\(Kreis \d+\)') { continue }
  $cc = $iso[$q[8]]; if (-not $known[$cc]) { continue }
  [void]$cities.Add(@($cc, $q[1], [double]::Parse($q[4], $inv), [double]::Parse($q[5], $inv), [int64]$q[14], [int64]$q[0], ($q[8] + '.' + $q[10])))
}
foreach ($c in ($cities | Sort-Object { $_[4] } -Descending)) {
  $cc = $c[0]
  if (-not $Ctry[$cc]) { $Ctry[$cc] = @{ s = @(); idx = @{}; p = New-Object System.Collections.ArrayList } }
  $si = $Ctry[$cc].idx[$c[6]]; if ($null -eq $si) { $si = -1 }
  [void]$Ctry[$cc].p.Add((& $J $c[1]) + ',' + $si + ',' + (& $F $c[2]) + ',' + (& $F $c[3]) + ',' + $c[5] + ',' + (& $K $c[4]))
}

$sb = New-Object System.Text.StringBuilder
[void]$sb.Append('{"v":1,"credit":"GeoNames (geonames.org), CC BY 4.0","c":{')
$first = $true; $ns = 0; $np = 0
foreach ($cc in ($Ctry.Keys | Sort-Object)) {
  if (-not $first) { [void]$sb.Append(",`n") }; $first = $false
  $st = @($Ctry[$cc].s | ForEach-Object { '[' + (& $J $_[0]) + ',' + (& $F $_[1]) + ',' + (& $F $_[2]) + ',' + $_[4] + ']' })
  $pl = @($Ctry[$cc].p | ForEach-Object { '[' + $_ + ']' })
  $ns += $st.Count; $np += $pl.Count
  [void]$sb.Append('"' + $cc + '":{"s":[' + ($st -join ',') + '],"p":[' + ($pl -join ',') + ']}')
}
[void]$sb.Append("}}`n")
[IO.File]::WriteAllText($out, $sb.ToString(), (New-Object System.Text.UTF8Encoding $false))
"places-v1.json: $($Ctry.Count) countries, $ns states, $np cities, $((Get-Item $out).Length) bytes"
