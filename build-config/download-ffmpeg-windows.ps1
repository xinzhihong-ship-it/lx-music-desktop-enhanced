param([ValidateSet('x64', 'x86', 'arm64')][string]$Arch)

$sources = @{
  x64 = @{ Url = 'https://github.com/System233/ffmpeg-msvc-prebuilt/releases/download/ffmpeg-8.1.2/ffmpeg-8.1.2_x64-windows-static-lgpl.zip'; Sha256 = '2dbaff015d97ba8b663d1a66a6b4da3ee099499ac2b0c88049bb33917191767f' }
  x86 = @{ Url = 'https://github.com/System233/ffmpeg-msvc-prebuilt/releases/download/ffmpeg-8.1.2/ffmpeg-8.1.2_x86-windows-static-lgpl.zip'; Sha256 = '02454614b39cf7decd757022440b8e575a876e831d4fc8340716d938a9b9360d' }
  arm64 = @{ Url = 'https://github.com/System233/ffmpeg-msvc-prebuilt/releases/download/ffmpeg-8.1.2/ffmpeg-8.1.2_arm64-windows-static-lgpl.zip'; Sha256 = '9fe6f183b7c890e4a8ad4afd25bd6c88e25673b6a58ff2d1dd1fe3d6253ced51' }
}

$root = Split-Path -Parent $PSScriptRoot
$build = Join-Path $root 'build'
New-Item -ItemType Directory -Force -Path $build | Out-Null
$temp = Join-Path $root "build\ffmpeg-$Arch.zip"
$extract = Join-Path $root "build\ffmpeg-$Arch"
$output = Join-Path $root "resources\ffmpeg\win32-$Arch"
$source = $sources[$Arch]
Invoke-WebRequest -Uri $source.Url -OutFile $temp
if ((Get-FileHash $temp -Algorithm SHA256).Hash.ToLower() -ne $source.Sha256) { throw "FFmpeg SHA-256 mismatch for $Arch" }
Expand-Archive -Path $temp -DestinationPath $extract -Force
$ffmpeg = Get-ChildItem $extract -Filter ffmpeg.exe -Recurse | Select-Object -First 1
$ffprobe = Get-ChildItem $extract -Filter ffprobe.exe -Recurse | Select-Object -First 1
if (!$ffmpeg -or !$ffprobe) { throw "FFmpeg binaries missing for $Arch" }
New-Item -ItemType Directory -Force -Path $output | Out-Null
Copy-Item $ffmpeg.FullName, $ffprobe.FullName -Destination $output -Force
if ($Arch -ne 'arm64') {
  $hasLame = & (Join-Path $output 'ffmpeg.exe') -hide_banner -encoders | Select-String -Quiet libmp3lame
  if (!$hasLame) { throw "libmp3lame encoder missing for $Arch" }
}
