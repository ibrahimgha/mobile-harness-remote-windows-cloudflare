param(
  [Parameter(Mandatory = $true)]
  [string]$AppName,

  [Parameter(Mandatory = $true)]
  [string]$AppUrl,

  [Parameter(Mandatory = $true)]
  [string]$AppUserModelId,

  [Parameter(Mandatory = $true)]
  [string]$IconPath,

  [Parameter(Mandatory = $true)]
  [string]$OutputDir,

  [Parameter(Mandatory = $true)]
  [string]$ExeName,

  [string]$ProfileConfigPath = "",

  [string]$UserDataFolderName = "",

  [string]$InstanceId = "default",

  [string]$InstanceName = "Default"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$packageUrl = "https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2"
$packageDir = Join-Path $PSScriptRoot ".packages\Microsoft.Web.WebView2"
$packageMarker = Join-Path $packageDir ".ready"

function Resolve-CSharpCompiler {
  $candidates = @(
    (Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"),
    (Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe")
  )

  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }

  throw "C# compiler was not found. Expected .NET Framework csc.exe under $env:WINDIR\Microsoft.NET."
}

function Ensure-WebView2Package {
  $coreDll = Join-Path $packageDir "lib\net462\Microsoft.Web.WebView2.Core.dll"
  $winFormsDll = Join-Path $packageDir "lib\net462\Microsoft.Web.WebView2.WinForms.dll"
  $loaderDll = Join-Path $packageDir "runtimes\win-x64\native\WebView2Loader.dll"

  if ((Test-Path -LiteralPath $packageMarker) -and
      (Test-Path -LiteralPath $coreDll) -and
      (Test-Path -LiteralPath $winFormsDll) -and
      (Test-Path -LiteralPath $loaderDll)) {
    return
  }

  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $packageDir
  New-Item -ItemType Directory -Force -Path $packageDir | Out-Null

  $nupkgPath = Join-Path $packageDir "Microsoft.Web.WebView2.nupkg"
  $zipPath = Join-Path $packageDir "Microsoft.Web.WebView2.zip"
  Invoke-WebRequest -Uri $packageUrl -OutFile $nupkgPath
  Copy-Item -LiteralPath $nupkgPath -Destination $zipPath -Force
  Expand-Archive -Path $zipPath -DestinationPath $packageDir -Force
  New-Item -ItemType File -Force -Path $packageMarker | Out-Null
}

function ConvertTo-CSharpString {
  param([string]$Value)

  return $Value.Replace("\", "\\").Replace('"', '\"')
}

if (-not (Test-Path -LiteralPath $IconPath)) {
  throw "Icon file was not found: $IconPath"
}

Ensure-WebView2Package
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

if ([string]::IsNullOrWhiteSpace($UserDataFolderName)) {
  $UserDataFolderName = $ExeName
}

$objDir = Join-Path $OutputDir "obj"
New-Item -ItemType Directory -Force -Path $objDir | Out-Null

$coreReference = Join-Path $packageDir "lib\net462\Microsoft.Web.WebView2.Core.dll"
$winFormsReference = Join-Path $packageDir "lib\net462\Microsoft.Web.WebView2.WinForms.dll"
$loaderDll = Join-Path $packageDir "runtimes\win-x64\native\WebView2Loader.dll"
$sourcePath = Join-Path $objDir "Program.cs"
$exePath = Join-Path $OutputDir "$ExeName.exe"

$csAppName = ConvertTo-CSharpString $AppName
$csAppUrl = ConvertTo-CSharpString $AppUrl
$csAppUserModelId = ConvertTo-CSharpString $AppUserModelId
$csUserDataFolder = ConvertTo-CSharpString $UserDataFolderName
$csProfileConfigPath = ConvertTo-CSharpString $ProfileConfigPath
$csInstanceId = ConvertTo-CSharpString $InstanceId
$csInstanceName = ConvertTo-CSharpString $InstanceName

$programSource = @"
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class Program
{
  private const string AppName = "$csAppName";
  private const string AppUserModelId = "$csAppUserModelId";

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern int SetCurrentProcessExplicitAppUserModelID(string appID);

  [STAThread]
  private static void Main()
  {
    SetCurrentProcessExplicitAppUserModelID(AppUserModelId);
    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);
    Application.Run(new MainForm());
  }
}

internal sealed class MainForm : Form
{
  private const string AppName = "$csAppName";
  private const string AppUrl = "$csAppUrl";
  private const string UserDataFolderName = "$csUserDataFolder";
  private const string ProfileConfigPath = "$csProfileConfigPath";
  private const string InstanceId = "$csInstanceId";
  private const string InstanceName = "$csInstanceName";
  private readonly WebView2 webView;
  private readonly string windowStatePath;

  public MainForm()
  {
    Text = AppName;
    windowStatePath = Path.Combine(
      Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
      "CodexRemoteWindowsApps",
      UserDataFolderName,
      "window-state.json"
    );
    StartPosition = FormStartPosition.CenterScreen;
    Size = new Size(1280, 860);
    MinimumSize = new Size(900, 640);
    BackColor = Color.FromArgb(245, 246, 241);
    Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);

    webView = new WebView2();
    webView.Dock = DockStyle.Fill;
    Controls.Add(webView);
    RestoreWindowState();
  }

  protected override void OnFormClosing(FormClosingEventArgs eventArgs)
  {
    SaveWindowState();
    base.OnFormClosing(eventArgs);
  }

  private void RestoreWindowState()
  {
    try
    {
      if (!File.Exists(windowStatePath)) return;
      var serializer = new JavaScriptSerializer();
      var state = serializer.Deserialize<WindowPlacement>(File.ReadAllText(windowStatePath));
      if (state == null || state.width < MinimumSize.Width || state.height < MinimumSize.Height) return;

      var bounds = new Rectangle(state.left, state.top, state.width, state.height);
      bool visible = false;
      foreach (Screen screen in Screen.AllScreens)
      {
        if (screen.WorkingArea.IntersectsWith(bounds))
        {
          visible = true;
          break;
        }
      }
      if (!visible) return;

      StartPosition = FormStartPosition.Manual;
      Bounds = bounds;
      if (state.maximized) WindowState = FormWindowState.Maximized;
    }
    catch
    {
      // Use the centered default when saved monitor geometry is no longer valid.
    }
  }

  private void SaveWindowState()
  {
    try
    {
      Rectangle bounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
      Directory.CreateDirectory(Path.GetDirectoryName(windowStatePath));
      var serializer = new JavaScriptSerializer();
      File.WriteAllText(windowStatePath, serializer.Serialize(new WindowPlacement
      {
        left = bounds.Left,
        top = bounds.Top,
        width = bounds.Width,
        height = bounds.Height,
        maximized = WindowState == FormWindowState.Maximized
      }));
    }
    catch
    {
      // A preference write must never block app shutdown.
    }
  }

  protected override async void OnShown(EventArgs eventArgs)
  {
    base.OnShown(eventArgs);

    try
    {
      string userDataRoot = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "CodexRemoteWindowsApps",
        UserDataFolderName
      );
      Directory.CreateDirectory(userDataRoot);

      CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, userDataRoot);
      await webView.EnsureCoreWebView2Async(environment);
      webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
      webView.CoreWebView2.Settings.AreDevToolsEnabled = true;
      webView.CoreWebView2.DocumentTitleChanged += delegate { Text = AppName; };
      webView.CoreWebView2.NavigationCompleted += delegate { SendMachineProfiles(); };
      webView.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs args)
      {
        args.Handled = true;
        webView.CoreWebView2.Navigate(args.Uri);
      };
      webView.CoreWebView2.Navigate(AppUrl);
    }
    catch (Exception ex)
    {
      MessageBox.Show(
        "The Windows WebView2 runtime is required to open this app." + Environment.NewLine + Environment.NewLine + ex.Message,
        AppName,
        MessageBoxButtons.OK,
        MessageBoxIcon.Error
      );
    }
  }

  private void SendMachineProfiles()
  {
    if (string.IsNullOrWhiteSpace(ProfileConfigPath) || !File.Exists(ProfileConfigPath) || webView.CoreWebView2 == null)
    {
      return;
    }

    try
    {
      var serializer = new JavaScriptSerializer();
      var encrypted = serializer.Deserialize<EncryptedProfileConfig>(File.ReadAllText(ProfileConfigPath));
      var machines = new List<DecryptedMachineProfile>();

      if (encrypted != null && encrypted.machines != null)
      {
        foreach (var machine in encrypted.machines)
        {
          byte[] protectedToken = Convert.FromBase64String(machine.encryptedToken ?? "");
          byte[] clearToken = ProtectedData.Unprotect(protectedToken, null, DataProtectionScope.CurrentUser);
          machines.Add(new DecryptedMachineProfile
          {
            id = machine.id,
            name = machine.name,
            url = machine.url,
            token = Encoding.UTF8.GetString(clearToken)
          });
        }
      }

      webView.CoreWebView2.PostWebMessageAsJson(serializer.Serialize(new
      {
        type = "codex-control-room-profiles",
        instanceId = InstanceId,
        instanceName = InstanceName,
        machines = machines
      }));
    }
    catch (Exception ex)
    {
      MessageBox.Show(
        "Codex Control Room could not unlock its machine profiles." + Environment.NewLine + Environment.NewLine + ex.Message,
        AppName,
        MessageBoxButtons.OK,
        MessageBoxIcon.Warning
      );
    }
  }
}

internal sealed class EncryptedProfileConfig
{
  public EncryptedMachineProfile[] machines { get; set; }
}

internal sealed class EncryptedMachineProfile
{
  public string id { get; set; }
  public string name { get; set; }
  public string url { get; set; }
  public string encryptedToken { get; set; }
}

internal sealed class DecryptedMachineProfile
{
  public string id { get; set; }
  public string name { get; set; }
  public string url { get; set; }
  public string token { get; set; }
}

internal sealed class WindowPlacement
{
  public int left { get; set; }
  public int top { get; set; }
  public int width { get; set; }
  public int height { get; set; }
  public bool maximized { get; set; }
}
"@

Set-Content -Path $sourcePath -Value $programSource -Encoding UTF8

$cscPath = Resolve-CSharpCompiler
& $cscPath `
  /nologo `
  /target:winexe `
  /platform:x64 `
  /optimize+ `
  "/win32icon:$IconPath" `
  "/out:$exePath" `
  "/reference:$coreReference" `
  "/reference:$winFormsReference" `
  "/reference:System.dll" `
  "/reference:System.Core.dll" `
  "/reference:System.Drawing.dll" `
  "/reference:System.Security.dll" `
  "/reference:System.Web.Extensions.dll" `
  "/reference:System.Windows.Forms.dll" `
  $sourcePath

Copy-Item -LiteralPath $coreReference -Destination (Join-Path $OutputDir "Microsoft.Web.WebView2.Core.dll") -Force
Copy-Item -LiteralPath $winFormsReference -Destination (Join-Path $OutputDir "Microsoft.Web.WebView2.WinForms.dll") -Force
Copy-Item -LiteralPath $loaderDll -Destination (Join-Path $OutputDir "WebView2Loader.dll") -Force

Write-Host "Built $AppName wrapper: $exePath"
