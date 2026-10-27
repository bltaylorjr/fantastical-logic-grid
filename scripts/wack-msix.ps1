# Packages one Tauri desktop app (desktop or desktop-admin) as an MSIX, the
# format the Microsoft Store and today's Windows App Certification Kit test
# (the kit no longer tests plain setup.exe installers), signs it with a
# throwaway test certificate so this machine will install it, and runs the kit.
# The Store re-signs any package it accepts with Microsoft's own certificate,
# so this one never ships; it only proves the app passes the kit.
# Used by .github/workflows/wack.yml after "tauri build".
# Run: pwsh scripts/wack-msix.ps1 -App desktop -Out C:\temp
param(
  [Parameter(Mandatory)][ValidateSet('desktop', 'desktop-admin')][string]$App,
  [Parameter(Mandatory)][string]$Out
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$tauri = Join-Path $root "$App\src-tauri"
$conf = Get-Content (Join-Path $tauri 'tauri.conf.json') -Raw | ConvertFrom-Json
$cargo = Get-Content (Join-Path $tauri 'Cargo.toml') -Raw
$bin = ([regex]::Match($cargo, '(?m)^name\s*=\s*"([^"]+)"')).Groups[1].Value
$exe = Join-Path $tauri "target\release\$bin.exe"
if (-not (Test-Path $exe)) { throw "Build $App first: $exe is missing." }

$version = "$($conf.version).0"
$name = ($conf.productName -replace '[^A-Za-z0-9]', '')
$subject = 'CN=FantasticalLogicGridTest'
$sdk = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\10.*\x64\makeappx.exe" | Sort-Object FullName | Select-Object -Last 1
$bins = $sdk.DirectoryName
$appcert = "${env:ProgramFiles(x86)}\Windows Kits\10\App Certification Kit\appcert.exe"

# Package layout: the program file and its tile pictures (Tauri made them in icons/).
$layout = Join-Path $Out "$App-layout"
Remove-Item $layout -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory "$layout\Assets" | Out-Null
Copy-Item $exe $layout
foreach ($logo in 'StoreLogo', 'Square44x44Logo', 'Square150x150Logo') {
  Copy-Item (Join-Path $tauri "icons\$logo.png") "$layout\Assets\$logo.png"
}
$description = if ($conf.bundle.shortDescription) { $conf.bundle.shortDescription } else { $conf.productName }
@"
<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
         xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
         xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
         IgnorableNamespaces="uap rescap">
  <Identity Name="$name" Publisher="$subject" Version="$version" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>$($conf.productName)</DisplayName>
    <PublisherDisplayName>$($conf.bundle.publisher)</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Applications>
    <Application Id="App" Executable="$bin.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements DisplayName="$($conf.productName)" Description="$description" BackgroundColor="transparent"
        Square150x150Logo="Assets\Square150x150Logo.png" Square44x44Logo="Assets\Square44x44Logo.png" />
    </Application>
  </Applications>
  <Capabilities>
    <Capability Name="internetClient" />
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@ | Set-Content "$layout\AppxManifest.xml" -Encoding utf8

$msix = Join-Path $Out "$App.msix"
& "$bins\makeappx.exe" pack /o /d $layout /p $msix
if ($LASTEXITCODE) { throw "makeappx failed ($LASTEXITCODE)." }

# Throwaway test certificate, trusted on this machine only.
$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $subject -CertStoreLocation Cert:\CurrentUser\My `
  -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}')
$pfx = Join-Path $Out 'test-cert.pfx'
$password = ConvertTo-SecureString -String ([guid]::NewGuid().ToString()) -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $password | Out-Null
Import-PfxCertificate -FilePath $pfx -CertStoreLocation Cert:\LocalMachine\TrustedPeople -Password $password | Out-Null
& "$bins\signtool.exe" sign /fd SHA256 /sha1 $cert.Thumbprint /s My $msix
if ($LASTEXITCODE) { throw "signtool failed ($LASTEXITCODE)." }
Remove-Item $pfx

# The kit itself: it installs the package, starts the app, checks it and removes it.
$report = Join-Path $Out "wack-$App.xml"
& $appcert reset | Out-Host
& $appcert test -appxpackagepath $msix -reportoutputpath $report | Out-Host
$code = $LASTEXITCODE
if ($code -eq 1) { & $appcert finalizereport -reportfilepath $report | Out-Host; $code = 0 }
Write-Host "appcert exit code $code"
if (-not (Test-Path $report)) { throw "The kit wrote no report (exit code $code)." }
