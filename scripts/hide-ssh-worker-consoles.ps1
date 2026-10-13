param([switch]$Once, [switch]$Observe, [int]$ObserveSeconds=20)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class SshWorkerConsoles {
    public static HashSet<uint> Roots = new HashSet<uint>();
    public static int HiddenCount;
    public delegate bool EnumProc(IntPtr hwnd, IntPtr arg);
    public delegate void EventProc(IntPtr hook, uint evt, IntPtr hwnd, int obj, int child, uint thread, uint time);
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct Entry {
        public uint size, usage, pid; public IntPtr heap; public uint module, threads, parent;
        public int priority; public uint flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst=260)] public string exe;
    }
    [DllImport("kernel32.dll")] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snap, ref Entry entry);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern bool Process32NextW(IntPtr snap, ref Entry entry);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr arg);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassNameW(IntPtr hwnd, StringBuilder text, int count);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int command);
    [DllImport("user32.dll")] public static extern IntPtr SetWinEventHook(uint min, uint max, IntPtr module, EventProc callback, uint pid, uint thread, uint flags);
    [DllImport("user32.dll")] public static extern bool UnhookWinEvent(IntPtr hook);
    public static EventProc Callback = OnEvent;
    static Dictionary<uint,uint> Parents() {
        var result = new Dictionary<uint,uint>();
        var snap = CreateToolhelp32Snapshot(2, 0);
        if (snap == new IntPtr(-1)) return result;
        try {
            var e = new Entry(); e.size = (uint)Marshal.SizeOf(typeof(Entry));
            if (Process32FirstW(snap, ref e)) do { result[e.pid]=e.parent; } while(Process32NextW(snap, ref e));
        } finally { CloseHandle(snap); }
        return result;
    }
    static bool Matches(IntPtr hwnd, Dictionary<uint,uint> parents) {
        var name = new StringBuilder(128); GetClassNameW(hwnd, name, 128);
        if (name.ToString() != "ConsoleWindowClass") return false;
        uint pid; GetWindowThreadProcessId(hwnd, out pid);
        for (int i=0; i<32 && pid != 0; i++) {
            if (Roots.Contains(pid)) return true;
            uint parent; if (!parents.TryGetValue(pid, out parent) || parent == pid) break;
            pid=parent;
        }
        return false;
    }
    static void Hide(IntPtr hwnd, Dictionary<uint,uint> parents) {
        if (IsWindowVisible(hwnd) && Matches(hwnd, parents)) { ShowWindow(hwnd, 0); HiddenCount++; }
    }
    static void OnEvent(IntPtr hook, uint evt, IntPtr hwnd, int obj, int child, uint thread, uint time) {
        if (hwnd != IntPtr.Zero && (evt == 3 || obj == 0)) Hide(hwnd, Parents());
    }
    public static void Sweep() {
        var parents=Parents(); EnumWindows((hwnd,arg)=>{Hide(hwnd,parents);return true;},IntPtr.Zero);
    }
    public static int VisibleCount() {
        int n=0; var parents=Parents(); EnumWindows((hwnd,arg)=>{if(IsWindowVisible(hwnd) && Matches(hwnd,parents)) n++;return true;},IntPtr.Zero); return n;
    }
}
'@
function Update-SshRoots {
    [SshWorkerConsoles]::Roots.Clear()
    Get-CimInstance Win32_Process -Filter "name='sshd.exe'" |
        Where-Object { $_.CommandLine -like '*ibrahim-hp-tc11-sshd*' -and $_.CommandLine -notmatch ' -(R|z)($| )' } |
        ForEach-Object { [void][SshWorkerConsoles]::Roots.Add([uint32]$_.ProcessId) }
}
Update-SshRoots
if ($Observe) {
    $maxVisible=0; $samples=0
    $until=[DateTime]::UtcNow.AddSeconds($ObserveSeconds)
    while ([DateTime]::UtcNow -lt $until) {
        $maxVisible=[Math]::Max($maxVisible,[SshWorkerConsoles]::VisibleCount())
        $samples++
        Start-Sleep -Milliseconds 100
    }
    [pscustomobject]@{Roots=@([SshWorkerConsoles]::Roots);Samples=$samples;MaxVisible=$maxVisible} | ConvertTo-Json -Compress
    exit
}
if ($Once) {
    [SshWorkerConsoles]::Sweep()
    [pscustomobject]@{Roots=@([SshWorkerConsoles]::Roots);Hidden=[SshWorkerConsoles]::HiddenCount;VisibleRemaining=[SshWorkerConsoles]::VisibleCount()} | ConvertTo-Json -Compress
    exit
}
$created=$false
$mutex=[System.Threading.Mutex]::new($true,'Local\IbrahimHpSshConsoleHider',[ref]$created)
if (-not $created) { $mutex.Dispose(); exit }
$showHook=[SshWorkerConsoles]::SetWinEventHook(0x8002,0x8002,[IntPtr]::Zero,[SshWorkerConsoles]::Callback,0,0,0)
$focusHook=[SshWorkerConsoles]::SetWinEventHook(3,3,[IntPtr]::Zero,[SshWorkerConsoles]::Callback,0,0,0)
try {
    $nextRefresh=[DateTime]::UtcNow
    while ($true) {
        if ([DateTime]::UtcNow -ge $nextRefresh) {
            Update-SshRoots
            [SshWorkerConsoles]::Sweep()
            $nextRefresh=[DateTime]::UtcNow.AddSeconds(2)
        }
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 30
    }
} finally {
    [void][SshWorkerConsoles]::UnhookWinEvent($showHook)
    [void][SshWorkerConsoles]::UnhookWinEvent($focusHook)
    $mutex.ReleaseMutex(); $mutex.Dispose()
}
