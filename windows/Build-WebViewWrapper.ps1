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
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
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
  private static readonly string TrustedFrameAncestor = new Uri(AppUrl).GetLeftPart(UriPartial.Authority);
  private readonly WebView2 webView;
  private readonly string windowStatePath;
  private readonly string dashboardStorePath;
  private readonly string controlRoomStatePath;
  private readonly string frozenSquareDirectory;
  private readonly string knobTracePath;
  private readonly string lastActiveControlRoomPath;
  private readonly Dictionary<string, string> activeDashboardIds = new Dictionary<string, string>();
  private readonly Dictionary<string, DateTime> lastDashboardFillAt = new Dictionary<string, DateTime>();
  private readonly Dictionary<uint, string> frameNavigationUris = new Dictionary<uint, string>();
  private readonly System.Windows.Forms.Timer resourceUsageTimer;
  private readonly System.Windows.Forms.Timer globalKnobHotkeyTimer;
  private FileSystemWatcher dashboardWatcher;
  private readonly Mutex dashboardVaultMutex = new Mutex(false, @"Local\CodexControlRoomDashboardVault");
  private bool isFullscreen;
  private bool restoreFullscreen;
  private Rectangle fullscreenRestoreBounds;
  private FormWindowState fullscreenRestoreState = FormWindowState.Normal;
  private ulong previousCpuIdle;
  private ulong previousCpuKernel;
  private ulong previousCpuUser;
  private bool hasCpuSample;
  private long cachedDriveFreeBytes;
  private DateTime driveFreeSampledAt = DateTime.MinValue;
  private const int ActivateControlRoomMessage = 0x8001;
  private const int RouteKnobMessage = 0x8002;
  private const int WmHotkey = 0x0312;
  private const int WmKeyDown = 0x0100;
  private const int WmSystemKeyDown = 0x0104;
  private const int WhKeyboardLl = 13;
  private const int PreviousKnobHotkeyId = 0x4341;
  private const int NextKnobHotkeyId = 0x4342;
  private bool ownsGlobalKnobHotkeys;
  private DateTime lastCompletionLightAcknowledgementAt = DateTime.MinValue;
  private delegate IntPtr LowLevelKeyboardProc(int code, IntPtr wParam, IntPtr lParam);
  private readonly LowLevelKeyboardProc globalKeyboardCallback;
  private IntPtr globalKeyboardHook = IntPtr.Zero;

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool GetSystemTimes(
    out System.Runtime.InteropServices.ComTypes.FILETIME idleTime,
    out System.Runtime.InteropServices.ComTypes.FILETIME kernelTime,
    out System.Runtime.InteropServices.ComTypes.FILETIME userTime
  );

  [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
  private static extern bool GlobalMemoryStatusEx([In, Out] MemoryStatus memoryStatus);

  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
  private static extern int SHGetKnownFolderPath(ref Guid rfid, uint flags, IntPtr token, out IntPtr path);

  [DllImport("user32.dll")]
  private static extern short GetKeyState(int virtualKey);

  [DllImport("user32.dll")]
  private static extern bool SetForegroundWindow(IntPtr windowHandle);

  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr windowHandle, out uint processId);

  [DllImport("user32.dll")]
  private static extern bool AllowSetForegroundWindow(uint processId);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern IntPtr SetWindowsHookEx(int hookId, LowLevelKeyboardProc callback, IntPtr moduleHandle, uint threadId);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool UnhookWindowsHookEx(IntPtr hookHandle);

  [DllImport("user32.dll")]
  private static extern IntPtr CallNextHookEx(IntPtr hookHandle, int code, IntPtr wParam, IntPtr lParam);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
  private static extern IntPtr GetModuleHandle(string moduleName);

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  private static extern IntPtr FindWindow(string className, string windowName);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool RegisterHotKey(IntPtr windowHandle, int id, uint modifiers, uint virtualKey);

  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool UnregisterHotKey(IntPtr windowHandle, int id);

  [DllImport("user32.dll")]
  private static extern bool ShowWindow(IntPtr windowHandle, int command);

  [DllImport("user32.dll")]
  private static extern IntPtr SendMessage(IntPtr windowHandle, int message, IntPtr wParam, IntPtr lParam);

  private static string PhysicalLocalAppData()
  {
    Guid localAppData = new Guid("F1B32785-6FBA-4FCF-9D55-7B8E7F157091");
    IntPtr pathPointer;
    int result = SHGetKnownFolderPath(ref localAppData, 0x00010000, IntPtr.Zero, out pathPointer);
    if (result != 0 || pathPointer == IntPtr.Zero) return Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    try { return Marshal.PtrToStringUni(pathPointer); }
    finally { Marshal.FreeCoTaskMem(pathPointer); }
  }

  public MainForm()
  {
    globalKeyboardCallback = HandleGlobalKeyboardEvent;
    Text = AppName;
    string localAppDataRoot = PhysicalLocalAppData();
    windowStatePath = Path.Combine(
      localAppDataRoot,
      "CodexRemoteWindowsApps",
      UserDataFolderName,
      "window-state.json"
    );
    dashboardStorePath = Path.Combine(
      localAppDataRoot,
      "CodexRemoteWindowsApps",
      "Shared",
      "saved-dashboards.json"
    );
    controlRoomStatePath = Path.Combine(
      localAppDataRoot,
      "CodexRemoteWindowsApps",
      UserDataFolderName,
      "control-room-state.json"
    );
    frozenSquareDirectory = Path.Combine(
      localAppDataRoot,
      "CodexRemoteWindowsApps",
      UserDataFolderName,
      "frozen-squares"
    );
    knobTracePath = Path.Combine(localAppDataRoot, "CodexRemoteWindowsApps", "Shared", "knob-room-switch.log");
    lastActiveControlRoomPath = Path.Combine(localAppDataRoot, "CodexRemoteWindowsApps", "Shared", "last-active-control-room.txt");
    StartPosition = FormStartPosition.CenterScreen;
    Size = new Size(1280, 860);
    MinimumSize = new Size(900, 640);
    BackColor = Color.FromArgb(245, 246, 241);
    Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);

    webView = new WebView2();
    webView.Dock = DockStyle.Fill;
    Controls.Add(webView);
    resourceUsageTimer = new System.Windows.Forms.Timer();
    resourceUsageTimer.Interval = 2000;
    resourceUsageTimer.Tick += delegate { SendResourceUsage(); };
    globalKnobHotkeyTimer = new System.Windows.Forms.Timer();
    globalKnobHotkeyTimer.Interval = 2000;
    globalKnobHotkeyTimer.Tick += delegate { TryRegisterGlobalKnobHotkeys(); };
    globalKnobHotkeyTimer.Start();
    RestoreWindowState();
  }

  protected override void WndProc(ref Message message)
  {
    if (message.Msg == WmHotkey)
    {
      int hotkeyId = message.WParam.ToInt32();
      if (hotkeyId == PreviousKnobHotkeyId || hotkeyId == NextKnobHotkeyId)
      {
        RouteGlobalKnobDetent(hotkeyId == NextKnobHotkeyId ? "next" : "previous");
        return;
      }
    }
    if (message.Msg == ActivateControlRoomMessage)
    {
      int activationDirection = message.WParam.ToInt32();
      TraceKnob("activation-message direction=" + (activationDirection > 0 ? "next" : "previous"));
      ShowWindow(Handle, 9);
      bool foregrounded = SetForegroundWindow(Handle);
      Activate();
      BringToFront();
      webView.Select();
      bool webViewFocused = webView.Focus();
      bool resumeLastActiveSquare = Math.Abs(activationDirection) == 2;
      PostKnobFocus(resumeLastActiveSquare
        ? (activationDirection > 0 ? "resume-next" : "resume-previous")
        : (activationDirection > 0 ? "entry-next" : "entry-previous"));
      TraceKnob("activation-complete foregrounded=" + foregrounded + " webViewFocused=" + webViewFocused);
      return;
    }
    if (message.Msg == RouteKnobMessage)
    {
      int routeDirection = message.WParam.ToInt32();
      PostKnobFocus(routeDirection > 0 ? "next" : "previous");
      return;
    }
    base.WndProc(ref message);
  }

  protected override void OnActivated(EventArgs eventArgs)
  {
    base.OnActivated(eventArgs);
    RememberActiveControlRoom();
  }

  protected override void OnFormClosing(FormClosingEventArgs eventArgs)
  {
    SaveWindowState();
    resourceUsageTimer.Stop();
    resourceUsageTimer.Dispose();
    globalKnobHotkeyTimer.Stop();
    globalKnobHotkeyTimer.Dispose();
    ReleaseGlobalKnobHotkeys();
    if (dashboardWatcher != null) dashboardWatcher.Dispose();
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
      if (state.fullscreen)
      {
        fullscreenRestoreBounds = bounds;
        fullscreenRestoreState = state.maximized ? FormWindowState.Maximized : FormWindowState.Normal;
        restoreFullscreen = true;
      }
      else if (state.maximized)
      {
        WindowState = FormWindowState.Maximized;
      }
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
      Rectangle bounds = isFullscreen ? fullscreenRestoreBounds : (WindowState == FormWindowState.Normal ? Bounds : RestoreBounds);
      bool maximized = isFullscreen ? fullscreenRestoreState == FormWindowState.Maximized : WindowState == FormWindowState.Maximized;
      Directory.CreateDirectory(Path.GetDirectoryName(windowStatePath));
      var serializer = new JavaScriptSerializer();
      File.WriteAllText(windowStatePath, serializer.Serialize(new WindowPlacement
      {
        left = bounds.Left,
        top = bounds.Top,
        width = bounds.Width,
        height = bounds.Height,
        maximized = maximized,
        fullscreen = isFullscreen
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
    TryRegisterGlobalKnobHotkeys();

    if (restoreFullscreen)
    {
      restoreFullscreen = false;
      SetFullscreen(true);
    }

    try
    {
      string userDataRoot = Path.Combine(
        PhysicalLocalAppData(),
        "CodexRemoteWindowsApps",
        UserDataFolderName
      );
      Directory.CreateDirectory(userDataRoot);

      var environmentOptions = new CoreWebView2EnvironmentOptions("--allow-running-insecure-content");
      CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(null, userDataRoot, environmentOptions);
      await webView.EnsureCoreWebView2Async(environment);
      PrimeCpuSample();
      resourceUsageTimer.Start();
      StartDashboardWatcher();
      webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
      webView.CoreWebView2.Settings.AreDevToolsEnabled = true;
      webView.CoreWebView2.DocumentTitleChanged += delegate { Text = AppName; };
      webView.CoreWebView2.WebMessageReceived += HandleWebMessage;
      var controllerField = typeof(WebView2).GetField("_coreWebView2Controller", BindingFlags.Instance | BindingFlags.NonPublic);
      var controller = controllerField == null ? null : controllerField.GetValue(webView) as CoreWebView2Controller;
      if (controller == null) throw new InvalidOperationException("WebView2 controller is unavailable after initialization.");
      controller.AcceleratorKeyPressed += HandleAcceleratorKeyPressed;
      webView.CoreWebView2.NavigationCompleted += delegate
      {
        SendMachineProfiles();
        SendDashboards("");
        SendWindowState();
        SendControlRoomState();
        SendResourceUsage();
      };
      webView.CoreWebView2.BasicAuthenticationRequested += delegate(
        object sender,
        CoreWebView2BasicAuthenticationRequestedEventArgs args
      )
      {
        ApplyBasicAuthentication(args);
      };
      webView.CoreWebView2.FrameNavigationStarting += delegate(
        object sender,
        CoreWebView2NavigationStartingEventArgs args
      )
      {
        Uri frameUri;
        if (
          Uri.TryCreate(args.Uri, UriKind.Absolute, out frameUri) &&
          (frameUri.Scheme == Uri.UriSchemeHttp || frameUri.Scheme == Uri.UriSchemeHttps)
        )
        {
          args.AdditionalAllowedFrameAncestors = TrustedFrameAncestor;
        }
      };
      webView.CoreWebView2.FrameCreated += delegate(object sender, CoreWebView2FrameCreatedEventArgs args)
      {
        CoreWebView2Frame frame = args.Frame;
        frame.NavigationStarting += delegate(object frameSender, CoreWebView2NavigationStartingEventArgs frameArgs)
        {
          Uri frameUri;
          if (
            Uri.TryCreate(frameArgs.Uri, UriKind.Absolute, out frameUri) &&
            (frameUri.Scheme == Uri.UriSchemeHttp || frameUri.Scheme == Uri.UriSchemeHttps)
          )
          {
            frameArgs.AdditionalAllowedFrameAncestors = TrustedFrameAncestor;
          }
          frameNavigationUris[frame.FrameId] = frameArgs.Uri;
        };
        frame.NavigationCompleted += delegate(object frameSender, CoreWebView2NavigationCompletedEventArgs navigationArgs)
        {
          string slotId = frame.Name;
          if (string.IsNullOrWhiteSpace(slotId) || !slotId.StartsWith("workspace-")) return;

          bool failed = !navigationArgs.IsSuccess || navigationArgs.HttpStatusCode >= 400;
          string detail = navigationArgs.HttpStatusCode >= 400
            ? "HTTP " + navigationArgs.HttpStatusCode
            : navigationArgs.IsSuccess ? "" : navigationArgs.WebErrorStatus.ToString();
          SendFrameState(slotId, failed, detail);
          string navigatedUrl;
          frameNavigationUris.TryGetValue(frame.FrameId, out navigatedUrl);
          if (!failed) AutoFillDashboard(frame, slotId, navigatedUrl);
        };
      };
      webView.CoreWebView2.NewWindowRequested += delegate(object sender, CoreWebView2NewWindowRequestedEventArgs args)
      {
        args.Handled = true;
        Uri externalUri;
        if (
          Uri.TryCreate(args.Uri, UriKind.Absolute, out externalUri) &&
          (externalUri.Scheme == Uri.UriSchemeHttp || externalUri.Scheme == Uri.UriSchemeHttps)
        )
        {
          try
          {
            Process.Start(new ProcessStartInfo
            {
              FileName = externalUri.AbsoluteUri,
              UseShellExecute = true
            });
          }
          catch
          {
            // Keep the Control Room page in place if Windows cannot launch a browser.
          }
        }
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

  private void HandleAcceleratorKeyPressed(object sender, CoreWebView2AcceleratorKeyPressedEventArgs eventArgs)
  {
    if (
      eventArgs.KeyEventKind != CoreWebView2KeyEventKind.KeyDown &&
      eventArgs.KeyEventKind != CoreWebView2KeyEventKind.SystemKeyDown
    ) return;

    AcknowledgeCompletionLight();

    bool controlDown = (GetKeyState(0x11) & 0x8000) != 0;
    bool altDown = (GetKeyState(0x12) & 0x8000) != 0;
    if (!controlDown || !altDown) return;

    string direction = eventArgs.VirtualKey == 0x25
      ? "previous"
      : eventArgs.VirtualKey == 0x27 ? "next" : "";
    bool turnOffDisplay = eventArgs.VirtualKey == 0x30;
    bool toggleFarView = eventArgs.VirtualKey == 0x39;
    if (direction.Length == 0 && !turnOffDisplay && !toggleFarView) return;

    eventArgs.Handled = true;
    var serializer = new JavaScriptSerializer();
    if (turnOffDisplay || toggleFarView)
    {
      webView.CoreWebView2.PostWebMessageAsJson(serializer.Serialize(new
      {
        type = "codex-control-room-pad-action",
        action = turnOffDisplay ? "turn-off-display" : "toggle-far-view-focus"
      }));
    }
    else
    {
      TraceKnob("detent direction=" + direction);
      PostKnobFocus(direction);
    }
  }

  private void TryRegisterGlobalKnobHotkeys()
  {
    if (ownsGlobalKnobHotkeys || !IsHandleCreated || IsDisposed) return;

    const uint modifiers = 0x0001 | 0x0002;
    bool previousRegistered = RegisterHotKey(Handle, PreviousKnobHotkeyId, modifiers, 0x25);
    bool nextRegistered = RegisterHotKey(Handle, NextKnobHotkeyId, modifiers, 0x27);
    if (previousRegistered && nextRegistered)
    {
      ownsGlobalKnobHotkeys = true;
      TryInstallGlobalKeyboardHook();
      TraceKnob("global-hotkeys-owner");
      return;
    }

    if (previousRegistered) UnregisterHotKey(Handle, PreviousKnobHotkeyId);
    if (nextRegistered) UnregisterHotKey(Handle, NextKnobHotkeyId);
  }

  private void ReleaseGlobalKnobHotkeys()
  {
    if (globalKeyboardHook != IntPtr.Zero)
    {
      UnhookWindowsHookEx(globalKeyboardHook);
      globalKeyboardHook = IntPtr.Zero;
    }
    if (ownsGlobalKnobHotkeys && IsHandleCreated)
    {
      UnregisterHotKey(Handle, PreviousKnobHotkeyId);
      UnregisterHotKey(Handle, NextKnobHotkeyId);
    }
    ownsGlobalKnobHotkeys = false;
  }

  private void TryInstallGlobalKeyboardHook()
  {
    if (globalKeyboardHook != IntPtr.Zero) return;
    globalKeyboardHook = SetWindowsHookEx(WhKeyboardLl, globalKeyboardCallback, GetModuleHandle(null), 0);
    TraceKnob("global-keyboard-hook installed=" + (globalKeyboardHook != IntPtr.Zero));
  }

  private IntPtr HandleGlobalKeyboardEvent(int code, IntPtr wParam, IntPtr lParam)
  {
    if (code >= 0 && (wParam.ToInt32() == WmKeyDown || wParam.ToInt32() == WmSystemKeyDown))
    {
      try
      {
        BeginInvoke((Action)AcknowledgeCompletionLight);
      }
      catch
      {
        // The owner window may be closing while the keyboard event is delivered.
      }
    }
    return CallNextHookEx(globalKeyboardHook, code, wParam, lParam);
  }

  private void AcknowledgeCompletionLight()
  {
    if (webView.CoreWebView2 == null) return;
    if (DateTime.UtcNow - lastCompletionLightAcknowledgementAt < TimeSpan.FromMilliseconds(500)) return;
    lastCompletionLightAcknowledgementAt = DateTime.UtcNow;
    var serializer = new JavaScriptSerializer();
    webView.CoreWebView2.PostWebMessageAsJson(serializer.Serialize(new
    {
      type = "codex-control-room-pad-action",
      action = "acknowledge-completion-light"
    }));
  }

  private void RememberActiveControlRoom()
  {
    try
    {
      Directory.CreateDirectory(Path.GetDirectoryName(lastActiveControlRoomPath));
      File.WriteAllText(lastActiveControlRoomPath, InstanceId);
    }
    catch
    {
      // Focus routing falls back to the first open room if this hint cannot be saved.
    }
  }

  private Dictionary<string, IntPtr> FindOpenControlRoomWindows()
  {
    string[] instanceIds = { "default", "secondary", "instance-3", "instance-4", "instance-5", "instance-6" };
    var windows = new Dictionary<string, IntPtr>(StringComparer.OrdinalIgnoreCase);
    foreach (string instanceId in instanceIds)
    {
      IntPtr windowHandle = FindWindow(null, ControlRoomWindowTitle(instanceId));
      if (windowHandle != IntPtr.Zero) windows[instanceId] = windowHandle;
    }
    return windows;
  }

  private void RouteGlobalKnobDetent(string direction)
  {
    Dictionary<string, IntPtr> openWindows = FindOpenControlRoomWindows();
    if (openWindows.Count == 0) return;

    IntPtr foregroundWindow = GetForegroundWindow();
    IntPtr targetWindow = IntPtr.Zero;
    bool foregroundIsControlRoom = openWindows.ContainsValue(foregroundWindow);
    if (foregroundIsControlRoom)
    {
      targetWindow = foregroundWindow;
    }
    else
    {
      string lastActiveInstanceId = "";
      try
      {
        if (File.Exists(lastActiveControlRoomPath)) lastActiveInstanceId = File.ReadAllText(lastActiveControlRoomPath).Trim();
      }
      catch
      {
        // Fall through to the first open room.
      }

      if (!string.IsNullOrWhiteSpace(lastActiveInstanceId)) openWindows.TryGetValue(lastActiveInstanceId, out targetWindow);
      if (targetWindow == IntPtr.Zero)
      {
        string[] instanceIds = { "default", "secondary", "instance-3", "instance-4", "instance-5", "instance-6" };
        foreach (string instanceId in instanceIds)
        {
          if (openWindows.TryGetValue(instanceId, out targetWindow)) break;
        }
      }
    }

    if (targetWindow == IntPtr.Zero) return;
    int directionValue = direction == "next" ? 1 : -1;
    TraceKnob("global-detent direction=" + direction + " foregroundControlRoom=" + foregroundIsControlRoom);
    if (targetWindow == Handle)
    {
      if (!foregroundIsControlRoom)
      {
        ShowWindow(Handle, 9);
        SetForegroundWindow(Handle);
        Activate();
        BringToFront();
        webView.Select();
        webView.Focus();
        PostKnobFocus(directionValue > 0 ? "resume-next" : "resume-previous");
      }
      else
      {
        PostKnobFocus(direction);
      }
      return;
    }

    uint targetProcessId;
    GetWindowThreadProcessId(targetWindow, out targetProcessId);
    bool foregroundGranted = targetProcessId != 0 && AllowSetForegroundWindow(targetProcessId);
    TraceKnob("global-route targetProcessId=" + targetProcessId + " foregroundGranted=" + foregroundGranted);

    SendMessage(
      targetWindow,
      foregroundIsControlRoom ? RouteKnobMessage : ActivateControlRoomMessage,
      new IntPtr(foregroundIsControlRoom ? directionValue : directionValue * 2),
      IntPtr.Zero
    );
  }

  private void TraceKnob(string detail)
  {
    try
    {
      Directory.CreateDirectory(Path.GetDirectoryName(knobTracePath));
      File.AppendAllText(knobTracePath, DateTime.UtcNow.ToString("O") + " " + InstanceId + " " + detail + Environment.NewLine);
    }
    catch
    {
      // Diagnostics must never interrupt knob input.
    }
  }

  private void PostKnobFocus(string direction)
  {
    if (webView.CoreWebView2 == null) return;

    var serializer = new JavaScriptSerializer();
    webView.CoreWebView2.PostWebMessageAsJson(serializer.Serialize(new
    {
      type = "codex-control-room-knob-focus",
      direction = direction
    }));
  }

  private void ClearKnobFocus()
  {
    if (webView.CoreWebView2 == null) return;
    var serializer = new JavaScriptSerializer();
    webView.CoreWebView2.PostWebMessageAsJson(serializer.Serialize(new
    {
      type = "codex-control-room-knob-focus",
      direction = "clear"
    }));
  }

  private static string ControlRoomWindowTitle(string instanceId)
  {
    if (instanceId == "default") return "Codex Control Room";
    if (instanceId == "secondary") return "Codex Control Room - Secondary";
    return "Codex Control Room - Instance " + instanceId.Substring("instance-".Length);
  }

  private void SwitchControlRoom(string direction)
  {
    int offset = direction == "next" ? 1 : -1;
    string[] instanceIds = { "default", "secondary", "instance-3", "instance-4", "instance-5", "instance-6" };
    int currentIndex = Array.IndexOf(instanceIds, InstanceId);
    if (currentIndex < 0) currentIndex = 0;
    Dictionary<string, IntPtr> openWindows = FindOpenControlRoomWindows();

    for (int distance = 1; distance < instanceIds.Length; distance += 1)
    {
      int targetIndex = (currentIndex + (offset * distance) + instanceIds.Length) % instanceIds.Length;
      IntPtr windowHandle;
      if (!openWindows.TryGetValue(instanceIds[targetIndex], out windowHandle)) continue;
      TraceKnob("switch-target direction=" + direction + " instance=" + instanceIds[targetIndex]);
      ClearKnobFocus();
      ShowWindow(windowHandle, 9);
      bool foregrounded = SetForegroundWindow(windowHandle);
      IntPtr activationResult = SendMessage(windowHandle, ActivateControlRoomMessage, new IntPtr(direction == "next" ? 1 : -1), IntPtr.Zero);
      TraceKnob("switch-complete foregrounded=" + foregrounded + " activationResult=" + activationResult);
      return;
    }
  }

  private void HandleWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs eventArgs)
  {
    try
    {
      var serializer = new JavaScriptSerializer();
      var message = serializer.Deserialize<WindowCommand>(eventArgs.WebMessageAsJson);
      if (message != null && message.type == "codex-control-room-fullscreen")
      {
        SetFullscreen(message.enabled);
      }
      else if (message != null && message.type == "codex-control-room-profiles-request")
      {
        SendMachineProfiles();
        SendWindowState();
        SendControlRoomState();
      }
      else if (message != null && message.type == "codex-control-room-dashboards-request")
      {
        SendDashboards("");
      }
      else if (message != null && message.type == "codex-control-room-dashboard-save")
      {
        SaveDashboard(message.dashboard, message.requestId);
      }
      else if (message != null && message.type == "codex-control-room-dashboard-delete")
      {
        DeleteDashboard(message.dashboardId);
      }
      else if (message != null && message.type == "codex-control-room-dashboard-activate")
      {
        ActivateDashboard(message.slotId, message.dashboardId);
      }
      else if (message != null && message.type == "codex-control-room-state-save")
      {
        SaveControlRoomState(message.state);
      }
      else if (message != null && message.type == "codex-control-room-switch-request")
      {
        if (message.direction == "previous" || message.direction == "next")
        {
          TraceKnob("switch-request direction=" + message.direction);
          SwitchControlRoom(message.direction);
        }
      }
      else if (message != null && message.type == "codex-control-room-frozen-square-capture")
      {
        CaptureFrozenSquare(message);
      }
      else if (message != null && message.type == "codex-control-room-frozen-square-request")
      {
        SendStoredFrozenSquare(message.slotId);
      }
      else if (message != null && message.type == "codex-control-room-frozen-square-delete")
      {
        DeleteFrozenSquare(message.slotId);
      }
    }
    catch
    {
      // Ignore messages that are not native window commands.
    }
  }

  private void SetFullscreen(bool enabled)
  {
    if (enabled == isFullscreen)
    {
      SendWindowState();
      return;
    }

    SuspendLayout();
    if (enabled)
    {
      if (fullscreenRestoreBounds.Width <= 0 || fullscreenRestoreBounds.Height <= 0)
      {
        fullscreenRestoreBounds = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
        fullscreenRestoreState = WindowState;
      }
      WindowState = FormWindowState.Normal;
      FormBorderStyle = FormBorderStyle.None;
      Bounds = Screen.FromRectangle(fullscreenRestoreBounds).Bounds;
      isFullscreen = true;
    }
    else
    {
      WindowState = FormWindowState.Normal;
      FormBorderStyle = FormBorderStyle.Sizable;
      Bounds = fullscreenRestoreBounds;
      if (fullscreenRestoreState == FormWindowState.Maximized) WindowState = FormWindowState.Maximized;
      isFullscreen = false;
      fullscreenRestoreBounds = Rectangle.Empty;
    }
    ResumeLayout(true);
    SendWindowState();
  }

  private void SendWindowState()
  {
    if (webView.CoreWebView2 == null) return;
    var serializer = new JavaScriptSerializer();
    webView.CoreWebView2.PostWebMessageAsJson(serializer.Serialize(new
    {
      type = "codex-control-room-window-state",
      fullscreen = isFullscreen
    }));
  }

  private void SendControlRoomState()
  {
    if (webView.CoreWebView2 == null) return;
    var serializer = new JavaScriptSerializer();
    object state = null;
    try
    {
      if (File.Exists(controlRoomStatePath)) state = serializer.DeserializeObject(File.ReadAllText(controlRoomStatePath));
    }
    catch { state = null; }
    webView.CoreWebView2.PostWebMessageAsJson(serializer.Serialize(new
    {
      type = "codex-control-room-state",
      state = state
    }));
  }

  private void SaveControlRoomState(object state)
  {
    if (state == null) return;
    string directory = Path.GetDirectoryName(controlRoomStatePath);
    Directory.CreateDirectory(directory);
    string temporaryPath = controlRoomStatePath + ".tmp";
    var serializer = new JavaScriptSerializer();
    File.WriteAllText(temporaryPath, serializer.Serialize(state), new UTF8Encoding(false));
    if (File.Exists(controlRoomStatePath)) File.Replace(temporaryPath, controlRoomStatePath, null);
    else File.Move(temporaryPath, controlRoomStatePath);
  }

  private void SendFrameState(string slotId, bool failed, string detail)
  {
    if (webView.CoreWebView2 == null) return;
    var serializer = new JavaScriptSerializer();
    webView.CoreWebView2.PostWebMessageAsJson(serializer.Serialize(new
    {
      type = "codex-control-room-frame-state",
      slotId = slotId,
      failed = failed,
      detail = detail
    }));
  }

  private static ulong FileTimeValue(System.Runtime.InteropServices.ComTypes.FILETIME value)
  {
    return ((ulong)(uint)value.dwHighDateTime << 32) | (uint)value.dwLowDateTime;
  }

  private void PrimeCpuSample()
  {
    System.Runtime.InteropServices.ComTypes.FILETIME idle;
    System.Runtime.InteropServices.ComTypes.FILETIME kernel;
    System.Runtime.InteropServices.ComTypes.FILETIME user;
    if (!GetSystemTimes(out idle, out kernel, out user)) return;
    previousCpuIdle = FileTimeValue(idle);
    previousCpuKernel = FileTimeValue(kernel);
    previousCpuUser = FileTimeValue(user);
    hasCpuSample = true;
  }

  private double ReadCpuPercent()
  {
    System.Runtime.InteropServices.ComTypes.FILETIME idle;
    System.Runtime.InteropServices.ComTypes.FILETIME kernel;
    System.Runtime.InteropServices.ComTypes.FILETIME user;
    if (!GetSystemTimes(out idle, out kernel, out user)) return 0;

    ulong currentIdle = FileTimeValue(idle);
    ulong currentKernel = FileTimeValue(kernel);
    ulong currentUser = FileTimeValue(user);
    if (!hasCpuSample)
    {
      previousCpuIdle = currentIdle;
      previousCpuKernel = currentKernel;
      previousCpuUser = currentUser;
      hasCpuSample = true;
      return 0;
    }

    ulong idleDelta = currentIdle - previousCpuIdle;
    ulong kernelDelta = currentKernel - previousCpuKernel;
    ulong userDelta = currentUser - previousCpuUser;
    previousCpuIdle = currentIdle;
    previousCpuKernel = currentKernel;
    previousCpuUser = currentUser;
    ulong totalDelta = kernelDelta + userDelta;
    if (totalDelta == 0) return 0;
    return Math.Max(0, Math.Min(100, 100d * (totalDelta - Math.Min(idleDelta, totalDelta)) / totalDelta));
  }

  private long ReadInstanceWorkingSet()
  {
    long total = 0;
    var processIds = new HashSet<int>();
    processIds.Add(Process.GetCurrentProcess().Id);
    if (webView.CoreWebView2 != null)
    {
      foreach (CoreWebView2ProcessInfo processInfo in webView.CoreWebView2.Environment.GetProcessInfos())
      {
        processIds.Add(processInfo.ProcessId);
      }
    }

    foreach (int processId in processIds)
    {
      try
      {
        using (Process process = Process.GetProcessById(processId)) total += Math.Max(0, process.WorkingSet64);
      }
      catch
      {
        // A WebView subprocess can exit between enumeration and sampling.
      }
    }
    return total;
  }

  private long ReadDriveFreeBytes()
  {
    if ((DateTime.UtcNow - driveFreeSampledAt).TotalSeconds < 30 && driveFreeSampledAt != DateTime.MinValue)
    {
      return cachedDriveFreeBytes;
    }
    try
    {
      cachedDriveFreeBytes = new DriveInfo("C:\\").AvailableFreeSpace;
      driveFreeSampledAt = DateTime.UtcNow;
    }
    catch
    {
      // Keep the last successful value if the drive is temporarily unavailable.
    }
    return cachedDriveFreeBytes;
  }

  private void SendResourceUsage()
  {
    if (webView.CoreWebView2 == null) return;
    try
    {
      var memory = new MemoryStatus();
      if (!GlobalMemoryStatusEx(memory)) return;
      var serializer = new JavaScriptSerializer();
      webView.CoreWebView2.PostWebMessageAsJson(serializer.Serialize(new
      {
        type = "codex-control-room-resource-usage",
        cpuPercent = Math.Round(ReadCpuPercent(), 1),
        memoryUsedPercent = (double)memory.dwMemoryLoad,
        driveFreeBytes = ReadDriveFreeBytes(),
        instanceWorkingSetBytes = ReadInstanceWorkingSet()
      }));
    }
    catch
    {
      // Resource telemetry must never affect the Control Room itself.
    }
  }

  private static bool IsSafeSlotId(string slotId)
  {
    if (string.IsNullOrWhiteSpace(slotId) || !slotId.StartsWith("workspace-", StringComparison.Ordinal)) return false;
    int number;
    return int.TryParse(slotId.Substring("workspace-".Length), out number) && number >= 1 && number <= 24;
  }

  private string FrozenSquarePath(string slotId)
  {
    return Path.Combine(frozenSquareDirectory, slotId + ".png");
  }

  private void SendFrozenSquare(string slotId, string dataUrl, string error)
  {
    if (webView.CoreWebView2 == null) return;
    var serializer = new JavaScriptSerializer();
    webView.CoreWebView2.PostWebMessageAsJson(serializer.Serialize(new
    {
      type = "codex-control-room-frozen-square",
      slotId = slotId ?? "",
      dataUrl = dataUrl ?? "",
      error = error ?? ""
    }));
  }

  private async void CaptureFrozenSquare(WindowCommand message)
  {
    if (message == null || !IsSafeSlotId(message.slotId)) return;
    if (message.width < 2 || message.height < 2 || message.width > 20000 || message.height > 20000)
    {
      SendFrozenSquare(message.slotId, "", "The square could not be captured at this size");
      return;
    }

    try
    {
      byte[] pngBytes;
      using (var previewStream = new MemoryStream())
      {
        await webView.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, previewStream);
        previewStream.Position = 0;
        using (var previewImage = Image.FromStream(previewStream))
        {
          double scaleX = previewImage.Width / Math.Max(1d, webView.ClientSize.Width);
          double scaleY = previewImage.Height / Math.Max(1d, webView.ClientSize.Height);
          int left = Math.Max(0, Math.Min(previewImage.Width - 1, (int)Math.Floor(message.x * scaleX)));
          int top = Math.Max(0, Math.Min(previewImage.Height - 1, (int)Math.Floor(message.y * scaleY)));
          int right = Math.Max(left + 1, Math.Min(previewImage.Width, (int)Math.Ceiling((message.x + message.width) * scaleX)));
          int bottom = Math.Max(top + 1, Math.Min(previewImage.Height, (int)Math.Ceiling((message.y + message.height) * scaleY)));
          var crop = Rectangle.FromLTRB(left, top, right, bottom);
          using (var frozenBitmap = new Bitmap(crop.Width, crop.Height, PixelFormat.Format32bppArgb))
          using (var graphics = Graphics.FromImage(frozenBitmap))
          using (var outputStream = new MemoryStream())
          {
            graphics.DrawImage(previewImage, new Rectangle(0, 0, crop.Width, crop.Height), crop, GraphicsUnit.Pixel);
            frozenBitmap.Save(outputStream, ImageFormat.Png);
            pngBytes = outputStream.ToArray();
          }
        }
      }
      if (pngBytes == null || pngBytes.Length == 0) throw new InvalidOperationException("WebView did not return screenshot data");
      string base64 = Convert.ToBase64String(pngBytes);

      Directory.CreateDirectory(frozenSquareDirectory);
      string finalPath = FrozenSquarePath(message.slotId);
      string temporaryPath = finalPath + ".tmp";
      File.WriteAllBytes(temporaryPath, pngBytes);
      if (File.Exists(finalPath)) File.Replace(temporaryPath, finalPath, null);
      else File.Move(temporaryPath, finalPath);
      SendFrozenSquare(message.slotId, "data:image/png;base64," + base64, "");
    }
    catch (Exception ex)
    {
      SendFrozenSquare(message.slotId, "", "Could not freeze square: " + ex.Message);
    }
  }

  private void SendStoredFrozenSquare(string slotId)
  {
    if (!IsSafeSlotId(slotId)) return;
    try
    {
      string filePath = FrozenSquarePath(slotId);
      if (!File.Exists(filePath))
      {
        SendFrozenSquare(slotId, "", "Frozen screenshot is missing; resume and freeze it again");
        return;
      }
      SendFrozenSquare(slotId, "data:image/png;base64," + Convert.ToBase64String(File.ReadAllBytes(filePath)), "");
    }
    catch (Exception ex)
    {
      SendFrozenSquare(slotId, "", "Could not restore frozen square: " + ex.Message);
    }
  }

  private void DeleteFrozenSquare(string slotId)
  {
    if (!IsSafeSlotId(slotId)) return;
    try { File.Delete(FrozenSquarePath(slotId)); }
    catch { }
  }

  private DashboardStore ReadDashboardStore()
  {
    if (!File.Exists(dashboardStorePath)) return new DashboardStore();
    var serializer = new JavaScriptSerializer();
    var store = serializer.Deserialize<DashboardStore>(File.ReadAllText(dashboardStorePath));
    if (store == null) store = new DashboardStore();
    if (store.dashboards == null) store.dashboards = new List<EncryptedDashboard>();
    return store;
  }

  private void StartDashboardWatcher()
  {
    string directory = Path.GetDirectoryName(dashboardStorePath);
    Directory.CreateDirectory(directory);
    dashboardWatcher = new FileSystemWatcher(directory, Path.GetFileName(dashboardStorePath));
    dashboardWatcher.NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size;
    FileSystemEventHandler refresh = delegate { ScheduleDashboardRefresh(); };
    RenamedEventHandler renamed = delegate { ScheduleDashboardRefresh(); };
    dashboardWatcher.Changed += refresh;
    dashboardWatcher.Created += refresh;
    dashboardWatcher.Deleted += refresh;
    dashboardWatcher.Renamed += renamed;
    dashboardWatcher.EnableRaisingEvents = true;
  }

  private void ScheduleDashboardRefresh()
  {
    if (IsDisposed || !IsHandleCreated) return;
    try
    {
      BeginInvoke((Action)delegate
      {
        if (!IsDisposed) SendDashboards("");
      });
    }
    catch
    {
      // The window may be closing while another instance updates the shared vault.
    }
  }

  private void WriteDashboardStore(DashboardStore store)
  {
    Directory.CreateDirectory(Path.GetDirectoryName(dashboardStorePath));
    var serializer = new JavaScriptSerializer();
    string temporaryPath = dashboardStorePath + "." + Guid.NewGuid().ToString("N") + ".tmp";
    File.WriteAllText(temporaryPath, serializer.Serialize(store), new UTF8Encoding(false));
    if (File.Exists(dashboardStorePath)) File.Replace(temporaryPath, dashboardStorePath, null);
    else File.Move(temporaryPath, dashboardStorePath);
  }

  private static string ProtectSecret(string value)
  {
    if (string.IsNullOrEmpty(value)) return "";
    byte[] clear = Encoding.UTF8.GetBytes(value);
    return Convert.ToBase64String(ProtectedData.Protect(clear, null, DataProtectionScope.CurrentUser));
  }

  private static string UnprotectSecret(string value)
  {
    if (string.IsNullOrEmpty(value)) return "";
    byte[] clear = ProtectedData.Unprotect(Convert.FromBase64String(value), null, DataProtectionScope.CurrentUser);
    return Encoding.UTF8.GetString(clear);
  }

  private void SendDashboards(string error)
  {
    SendDashboards(error, "");
  }

  private void SendDashboards(string error, string requestId)
  {
    if (webView.CoreWebView2 == null) return;
    try
    {
      DashboardStore store = ReadDashboardStore();
      var dashboards = new List<DashboardSummary>();
      foreach (EncryptedDashboard dashboard in store.dashboards)
      {
        dashboards.Add(new DashboardSummary
        {
          id = dashboard.id,
          name = dashboard.name,
          url = dashboard.url,
          credentialMode = dashboard.credentialMode,
          hasCredentials = dashboard.credentialMode == "access-key"
            ? !string.IsNullOrEmpty(dashboard.encryptedPassword)
            : !string.IsNullOrEmpty(dashboard.encryptedUsername) && !string.IsNullOrEmpty(dashboard.encryptedPassword),
          autoSubmit = dashboard.autoSubmit
        });
      }
      var serializer = new JavaScriptSerializer();
      webView.CoreWebView2.PostWebMessageAsJson(serializer.Serialize(new
      {
        type = "codex-control-room-dashboards",
        dashboards = dashboards,
        error = error ?? "",
        requestId = requestId ?? ""
      }));
    }
    catch (Exception ex)
    {
      var serializer = new JavaScriptSerializer();
      webView.CoreWebView2.PostWebMessageAsJson(serializer.Serialize(new
      {
        type = "codex-control-room-dashboards",
        dashboards = (object)null,
        error = "Could not unlock saved dashboards: " + ex.Message,
        requestId = requestId ?? ""
      }));
    }
  }

  private void SaveDashboard(DashboardInput input, string requestId)
  {
    bool locked = false;
    try
    {
      locked = dashboardVaultMutex.WaitOne(TimeSpan.FromSeconds(5));
      if (!locked) throw new InvalidOperationException("The shared dashboard vault is busy. Try again.");
      if (input == null) throw new InvalidOperationException("Dashboard details are missing.");
      string name = (input.name ?? "").Trim();
      string url = (input.url ?? "").Trim();
      string mode = input.credentialMode == "form" || input.credentialMode == "access-key" || input.credentialMode == "basic" ? input.credentialMode : "none";
      Uri parsed;
      if (name.Length == 0 || name.Length > 80) throw new InvalidOperationException("Enter a dashboard name of 80 characters or fewer.");
      if (!Uri.TryCreate(url, UriKind.Absolute, out parsed) || (parsed.Scheme != Uri.UriSchemeHttp && parsed.Scheme != Uri.UriSchemeHttps))
        throw new InvalidOperationException("Enter a complete http:// or https:// URL.");
      if (!string.IsNullOrEmpty(parsed.UserInfo)) throw new InvalidOperationException("Put credentials in the protected fields, not inside the URL.");

      DashboardStore store = ReadDashboardStore();
      EncryptedDashboard dashboard = null;
      foreach (EncryptedDashboard candidate in store.dashboards)
      {
        if (candidate.id == input.id) { dashboard = candidate; break; }
      }
      if (dashboard == null)
      {
        dashboard = new EncryptedDashboard { id = Guid.NewGuid().ToString("N") };
        store.dashboards.Add(dashboard);
      }

      string previousMode = dashboard.credentialMode ?? "none";
      dashboard.name = name;
      dashboard.url = parsed.AbsoluteUri;
      dashboard.credentialMode = mode;
      dashboard.autoSubmit = (mode == "form" || mode == "access-key") && input.autoSubmit;
      if (mode == "none")
      {
        dashboard.encryptedUsername = "";
        dashboard.encryptedPassword = "";
      }
      else if (mode == "access-key")
      {
        dashboard.encryptedUsername = "";
        if (!string.IsNullOrEmpty(input.password)) dashboard.encryptedPassword = ProtectSecret(input.password);
        else if (previousMode != "access-key" || string.IsNullOrEmpty(dashboard.encryptedPassword))
          throw new InvalidOperationException("Enter an access key.");
      }
      else
      {
        if (!string.IsNullOrEmpty(input.username)) dashboard.encryptedUsername = ProtectSecret(input.username);
        if (!string.IsNullOrEmpty(input.password)) dashboard.encryptedPassword = ProtectSecret(input.password);
      }
      WriteDashboardStore(store);
      SendDashboards("", requestId);
    }
    catch (Exception ex)
    {
      SendDashboards(ex.Message, requestId);
    }
    finally
    {
      if (locked) dashboardVaultMutex.ReleaseMutex();
    }
  }

  private void DeleteDashboard(string dashboardId)
  {
    bool locked = false;
    try
    {
      locked = dashboardVaultMutex.WaitOne(TimeSpan.FromSeconds(5));
      if (!locked) throw new InvalidOperationException("The shared dashboard vault is busy. Try again.");
      DashboardStore store = ReadDashboardStore();
      store.dashboards.RemoveAll(delegate(EncryptedDashboard dashboard) { return dashboard.id == dashboardId; });
      WriteDashboardStore(store);
      var slotsToClear = new List<string>();
      foreach (KeyValuePair<string, string> entry in activeDashboardIds)
        if (entry.Value == dashboardId) slotsToClear.Add(entry.Key);
      foreach (string slotId in slotsToClear) activeDashboardIds.Remove(slotId);
      SendDashboards("");
    }
    catch (Exception ex)
    {
      SendDashboards(ex.Message);
    }
    finally
    {
      if (locked) dashboardVaultMutex.ReleaseMutex();
    }
  }

  private void ActivateDashboard(string slotId, string dashboardId)
  {
    if (string.IsNullOrWhiteSpace(slotId) || !slotId.StartsWith("workspace-")) return;
    bool found = false;
    if (!string.IsNullOrWhiteSpace(dashboardId))
    {
      foreach (EncryptedDashboard dashboard in ReadDashboardStore().dashboards)
      {
        if (dashboard.id == dashboardId) { found = true; break; }
      }
    }
    if (found) activeDashboardIds[slotId] = dashboardId;
    else activeDashboardIds.Remove(slotId);
    lastDashboardFillAt.Remove(slotId);
  }

  private EncryptedDashboard ActiveDashboard(string slotId)
  {
    string dashboardId;
    if (!activeDashboardIds.TryGetValue(slotId, out dashboardId)) return null;
    foreach (EncryptedDashboard dashboard in ReadDashboardStore().dashboards)
      if (dashboard.id == dashboardId) return dashboard;
    return null;
  }

  private EncryptedDashboard DashboardForNavigation(string slotId, string navigatedUrl)
  {
    EncryptedDashboard active = ActiveDashboard(slotId);
    if (active != null) return active;
    Uri navigated;
    if (!Uri.TryCreate(navigatedUrl, UriKind.Absolute, out navigated)) return null;
    EncryptedDashboard match = null;
    foreach (EncryptedDashboard dashboard in ReadDashboardStore().dashboards)
    {
      if (dashboard.credentialMode != "form" && dashboard.credentialMode != "access-key") continue;
      Uri saved;
      if (!Uri.TryCreate(dashboard.url, UriKind.Absolute, out saved)) continue;
      if (saved.Scheme != navigated.Scheme || saved.Host != navigated.Host || saved.Port != navigated.Port) continue;
      if (match != null) return null;
      match = dashboard;
    }
    if (match != null) activeDashboardIds[slotId] = match.id;
    return match;
  }

  private void ApplyBasicAuthentication(CoreWebView2BasicAuthenticationRequestedEventArgs args)
  {
    try
    {
      Uri requested;
      if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out requested)) return;
      var dashboardIds = new HashSet<string>(activeDashboardIds.Values);
      foreach (EncryptedDashboard dashboard in ReadDashboardStore().dashboards)
      {
        if (!dashboardIds.Contains(dashboard.id) || dashboard.credentialMode != "basic") continue;
        Uri saved;
        if (!Uri.TryCreate(dashboard.url, UriKind.Absolute, out saved)) continue;
        if (saved.Scheme != requested.Scheme || saved.Host != requested.Host || saved.Port != requested.Port) continue;
        string username = UnprotectSecret(dashboard.encryptedUsername);
        string password = UnprotectSecret(dashboard.encryptedPassword);
        if (username.Length == 0 || password.Length == 0) return;
        args.Response.UserName = username;
        args.Response.Password = password;
        return;
      }
    }
    catch
    {
      // Fall back to WebView2's normal authentication prompt.
    }
  }

  private async void AutoFillDashboard(CoreWebView2Frame frame, string slotId, string navigatedUrl)
  {
    try
    {
      EncryptedDashboard dashboard = DashboardForNavigation(slotId, navigatedUrl);
      if (dashboard == null || (dashboard.credentialMode != "form" && dashboard.credentialMode != "access-key")) return;
      Uri saved;
      Uri navigated;
      if (!Uri.TryCreate(dashboard.url, UriKind.Absolute, out saved) || !Uri.TryCreate(navigatedUrl, UriKind.Absolute, out navigated)) return;
      if (saved.Scheme != navigated.Scheme || saved.Host != navigated.Host || saved.Port != navigated.Port) return;
      DateTime lastFill;
      if (lastDashboardFillAt.TryGetValue(slotId, out lastFill) && DateTime.UtcNow - lastFill < TimeSpan.FromSeconds(5)) return;
      bool accessKeyOnly = dashboard.credentialMode == "access-key";
      string username = accessKeyOnly ? "" : UnprotectSecret(dashboard.encryptedUsername);
      string password = UnprotectSecret(dashboard.encryptedPassword);
      if (password.Length == 0 || (!accessKeyOnly && username.Length == 0)) return;
      lastDashboardFillAt[slotId] = DateTime.UtcNow;

      var serializer = new JavaScriptSerializer();
      string script = "(function(){" +
        "var mode=" + serializer.Serialize(dashboard.credentialMode) + ",username=" + serializer.Serialize(username) + ",password=" + serializer.Serialize(password) + ",autoSubmit=" + (dashboard.autoSubmit ? "true" : "false") + ";" +
        "var visible=function(el){return el&&!el.disabled&&el.type!=='hidden'&&el.getClientRects().length>0;};" +
        "var first=function(selectors){for(var i=0;i<selectors.length;i++){var nodes=document.querySelectorAll(selectors[i]);for(var j=0;j<nodes.length;j++){if(visible(nodes[j]))return nodes[j];}}return null;};" +
        "var user=null,pass=null,target=null;" +
        "if(mode==='access-key'){target=first(['input[autocomplete=\"one-time-code\"]','input[name*=\"access-key\" i]','input[id*=\"access-key\" i]','input[name*=\"accesskey\" i]','input[id*=\"accesskey\" i]','input[name*=\"key\" i]','input[id*=\"key\" i]','input[name*=\"token\" i]','input[id*=\"token\" i]','input[name*=\"secret\" i]','input[id*=\"secret\" i]','input[type=\"password\"]']);if(!target){var candidates=Array.prototype.filter.call(document.querySelectorAll('input:not([type=\"hidden\"]):not([type=\"checkbox\"]):not([type=\"radio\"]):not([type=\"submit\"])'),visible);if(candidates.length===1)target=candidates[0];}}else{user=first(['input[autocomplete=\"username\"]','input[type=\"email\"]','input[name*=\"email\" i]','input[id*=\"email\" i]','input[name*=\"user\" i]','input[id*=\"user\" i]','input[type=\"text\"]']);pass=first(['input[autocomplete=\"current-password\"]','input[type=\"password\"]']);target=pass||user;}" +
        "var setValue=function(el,value){if(!el)return;var proto=Object.getPrototypeOf(el);var descriptor=Object.getOwnPropertyDescriptor(proto,'value');if(descriptor&&descriptor.set)descriptor.set.call(el,value);else el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};" +
        "if(mode==='access-key')setValue(target,password);else{setValue(user,username);setValue(pass,password);}" +
        "if(autoSubmit&&target){setTimeout(function(){var form=target.form||(user&&user.form);if(form){if(form.requestSubmit)form.requestSubmit();else form.submit();return;}var button=first(['button[type=\"submit\"]','input[type=\"submit\"]']);if(button)button.click();},300);}" +
        "return Boolean(target);})();";
      await frame.ExecuteScriptAsync(script);
    }
    catch
    {
      // Unsupported login pages remain available for manual sign-in.
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
  public bool fullscreen { get; set; }
}

internal sealed class DashboardStore
{
  public DashboardStore()
  {
    version = 1;
    dashboards = new List<EncryptedDashboard>();
  }

  public int version { get; set; }
  public List<EncryptedDashboard> dashboards { get; set; }
}

internal sealed class EncryptedDashboard
{
  public string id { get; set; }
  public string name { get; set; }
  public string url { get; set; }
  public string credentialMode { get; set; }
  public string encryptedUsername { get; set; }
  public string encryptedPassword { get; set; }
  public bool autoSubmit { get; set; }
}

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
internal sealed class MemoryStatus
{
  public uint dwLength = (uint)Marshal.SizeOf(typeof(MemoryStatus));
  public uint dwMemoryLoad;
  public ulong ullTotalPhys;
  public ulong ullAvailPhys;
  public ulong ullTotalPageFile;
  public ulong ullAvailPageFile;
  public ulong ullTotalVirtual;
  public ulong ullAvailVirtual;
  public ulong ullAvailExtendedVirtual;
}

internal sealed class DashboardSummary
{
  public string id { get; set; }
  public string name { get; set; }
  public string url { get; set; }
  public string credentialMode { get; set; }
  public bool hasCredentials { get; set; }
  public bool autoSubmit { get; set; }
}

internal sealed class DashboardInput
{
  public string id { get; set; }
  public string name { get; set; }
  public string url { get; set; }
  public string credentialMode { get; set; }
  public string username { get; set; }
  public string password { get; set; }
  public bool autoSubmit { get; set; }
}

internal sealed class WindowCommand
{
  public string type { get; set; }
  public string direction { get; set; }
  public bool enabled { get; set; }
  public string slotId { get; set; }
  public string dashboardId { get; set; }
  public string url { get; set; }
  public string requestId { get; set; }
  public DashboardInput dashboard { get; set; }
  public object state { get; set; }
  public double x { get; set; }
  public double y { get; set; }
  public double width { get; set; }
  public double height { get; set; }
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

if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $exePath)) {
  throw "Could not compile the $AppName wrapper."
}

Copy-Item -LiteralPath $coreReference -Destination (Join-Path $OutputDir "Microsoft.Web.WebView2.Core.dll") -Force
Copy-Item -LiteralPath $winFormsReference -Destination (Join-Path $OutputDir "Microsoft.Web.WebView2.WinForms.dll") -Force
Copy-Item -LiteralPath $loaderDll -Destination (Join-Path $OutputDir "WebView2Loader.dll") -Force

Write-Host "Built $AppName wrapper: $exePath"
