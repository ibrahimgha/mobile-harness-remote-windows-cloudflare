using System;
using System.Diagnostics;
using System.IO;

// Build as /target:winexe: the launcher itself must never allocate a console.
internal static class WatchdogLauncher
{
    private static int Main()
    {
        string root = Directory.GetParent(AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar)).FullName;
        try
        {
            var start = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"),
                Arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File \"" + Path.Combine(root, "scripts", "service.ps1") + "\" watchdog",
                WorkingDirectory = root,
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden
            };
            using (var child = Process.Start(start))
            {
                child.WaitForExit();
                return child.ExitCode;
            }
        }
        catch (Exception error)
        {
            try { File.AppendAllText(Path.Combine(root, ".runtime", "watchdog-launcher-error.log"), DateTimeOffset.Now.ToString("o") + " " + error.Message + Environment.NewLine); }
            catch { }
            return 1;
        }
    }
}
