param(
  [switch]$NoDesktopShortcut
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$AppName = "seo-man"
$AppUrl = "https://mobile-harness-remote-windows-cloudflare-vm13.bit68-infra.com/"
$AppUserModelId = "CodexRemote.SeoMan"
$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$IconPath = Join-Path $AppDir "seo-man.ico"

function Join-CandidatePath {
  param(
    [AllowNull()]
    [string]$Base,
    [string]$Child
  )

  if ([string]::IsNullOrWhiteSpace($Base)) {
    return $null
  }

  return Join-Path $Base $Child
}

function Resolve-Browser {
  $candidates = @(
    (Join-CandidatePath -Base ${env:ProgramFiles(x86)} -Child "Microsoft\Edge\Application\msedge.exe"),
    (Join-CandidatePath -Base $env:ProgramFiles -Child "Microsoft\Edge\Application\msedge.exe"),
    "msedge.exe",
    (Join-CandidatePath -Base $env:LOCALAPPDATA -Child "Google\Chrome\Application\chrome.exe"),
    (Join-CandidatePath -Base $env:ProgramFiles -Child "Google\Chrome\Application\chrome.exe"),
    "chrome.exe"
  )

  foreach ($candidate in $candidates) {
    if ([string]::IsNullOrWhiteSpace($candidate)) {
      continue
    }

    $command = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($command) {
      return $command.Source
    }

    if (Test-Path -LiteralPath $candidate) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  throw "Microsoft Edge or Google Chrome was not found."
}

function Resolve-AppLauncher {
  param([string]$BrowserPath)

  $browserName = Split-Path -Leaf $BrowserPath
  $browserDir = Split-Path -Parent $BrowserPath
  $proxyName = if ($browserName -ieq "chrome.exe") {
    "chrome_proxy.exe"
  } elseif ($browserName -ieq "msedge.exe") {
    "msedge_proxy.exe"
  } else {
    ""
  }

  if ($proxyName) {
    $proxyPath = Join-Path $browserDir $proxyName

    if (Test-Path -LiteralPath $proxyPath) {
      return (Resolve-Path -LiteralPath $proxyPath).Path
    }
  }

  return $BrowserPath
}

function Set-ShortcutAppUserModelId {
  param(
    [string]$ShortcutPath,
    [string]$AppId
  )

  if (-not ("ShortcutAppId" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("00021401-0000-0000-C000-000000000046")]
internal class ShellLink { }

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("0000010b-0000-0000-C000-000000000046")]
internal interface IPersistFile {
  void GetClassID(out Guid pClassID);
  [PreserveSig] int IsDirty();
  void Load([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, uint dwMode);
  void Save([MarshalAs(UnmanagedType.LPWStr)] string pszFileName, bool fRemember);
  void SaveCompleted([MarshalAs(UnmanagedType.LPWStr)] string pszFileName);
  void GetCurFile([MarshalAs(UnmanagedType.LPWStr)] out string ppszFileName);
}

[ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
internal interface IPropertyStore {
  void GetCount(out uint cProps);
  void GetAt(uint iProp, out PROPERTYKEY pkey);
  void GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
  void SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
  void Commit();
}

[StructLayout(LayoutKind.Sequential, Pack = 4)]
internal struct PROPERTYKEY {
  public Guid fmtid;
  public uint pid;
  public PROPERTYKEY(Guid fmtid, uint pid) {
    this.fmtid = fmtid;
    this.pid = pid;
  }
}

[StructLayout(LayoutKind.Sequential)]
internal struct PROPVARIANT : IDisposable {
  public ushort vt;
  public ushort wReserved1;
  public ushort wReserved2;
  public ushort wReserved3;
  public IntPtr p;
  public int p2;

  public static PROPVARIANT FromString(string value) {
    var pv = new PROPVARIANT();
    pv.vt = 31;
    pv.p = Marshal.StringToCoTaskMemUni(value);
    return pv;
  }

  public void Dispose() {
    PropVariantClear(ref this);
  }

  [DllImport("Ole32.dll")]
  private static extern int PropVariantClear(ref PROPVARIANT pvar);
}

public static class ShortcutAppId {
  public static void Set(string shortcutPath, string appId) {
    var shellLink = new ShellLink();
    var persistFile = (IPersistFile)shellLink;
    persistFile.Load(shortcutPath, 2);

    var propertyStore = (IPropertyStore)shellLink;
    var appIdKey = new PROPERTYKEY(new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), 5);
    var appIdValue = PROPVARIANT.FromString(appId);
    propertyStore.SetValue(ref appIdKey, ref appIdValue);
    propertyStore.Commit();
    appIdValue.Dispose();

    persistFile.Save(shortcutPath, true);
  }
}
"@
  }

  [ShortcutAppId]::Set($ShortcutPath, $AppId)
}

function New-AppShortcut {
  param(
    [string]$ShortcutPath,
    [string]$LauncherPath
  )

  $shortcutDir = Split-Path -Parent $ShortcutPath
  New-Item -ItemType Directory -Force -Path $shortcutDir | Out-Null

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $LauncherPath
  $shortcut.Arguments = "--app=$AppUrl --new-window"
  $shortcut.WorkingDirectory = Split-Path -Parent $LauncherPath
  $shortcut.Description = "Open seo-man remote"

  if (Test-Path -LiteralPath $IconPath) {
    $shortcut.IconLocation = "$IconPath,0"
  }

  $shortcut.Save()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut) | Out-Null
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) | Out-Null
  Set-ShortcutAppUserModelId -ShortcutPath $ShortcutPath -AppId $AppUserModelId
}

if (-not (Test-Path -LiteralPath $IconPath)) {
  & (Join-Path $AppDir "Build-Icon.ps1")
}

$browserPath = Resolve-Browser
$launcherPath = Resolve-AppLauncher -BrowserPath $browserPath
$startMenuPath = Join-Path ([Environment]::GetFolderPath("Programs")) "$AppName.lnk"
New-AppShortcut -ShortcutPath $startMenuPath -LauncherPath $launcherPath

if (-not $NoDesktopShortcut) {
  $desktopPath = Join-Path ([Environment]::GetFolderPath("Desktop")) "$AppName.lnk"
  New-AppShortcut -ShortcutPath $desktopPath -LauncherPath $launcherPath
}

Write-Host "Installed $AppName"
Write-Host "Launcher: $launcherPath"
Write-Host "Start Menu: $startMenuPath"
if (-not $NoDesktopShortcut) {
  Write-Host "Desktop: $desktopPath"
}
