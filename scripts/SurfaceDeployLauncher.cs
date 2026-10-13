using System;
using System.Diagnostics;
using System.IO;

// Compile as /target:winexe so Task Scheduler cannot create a visible console.
internal static class SurfaceDeployLauncher
{
    private static int Main()
    {
        string root = Directory.GetParent(AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar)).FullName;
        try
        {
            var start = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"),
                Arguments = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File \"" + Path.Combine(root, ".runtime", "queue-surface-confirmation-buttons.ps1") + "\"",
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
            try { File.AppendAllText(Path.Combine(root, ".runtime", "surface-deploy-launcher-error.log"), DateTimeOffset.Now.ToString("o") + " " + error.Message + Environment.NewLine); }
            catch { }
            return 1;
        }
    }
}
