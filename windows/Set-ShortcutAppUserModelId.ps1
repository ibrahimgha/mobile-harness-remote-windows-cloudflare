param(
  [Parameter(Mandatory = $true)]
  [string]$ShortcutPath,

  [Parameter(Mandatory = $true)]
  [string]$AppId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

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
