# Ibrahim HP Windows App

This folder contains a lightweight Windows app wrapper for the Codex Remote public URL:

https://mobile-harness-remote-windows-cloudflare-ibrahim-hp.bit68-infra.com/

It installs a Start Menu shortcut named **Ibrahim HP** and, by default, a Desktop shortcut. The shortcut opens Microsoft Edge or Google Chrome in app mode, similar to a PWA window, and uses the custom `ibrahim-hp.ico` icon.

## Install

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\IbrahimHP\Install-IbrahimHP.ps1
```

## Install Without Desktop Shortcut

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\IbrahimHP\Install-IbrahimHP.ps1 -NoDesktopShortcut
```

## Uninstall

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\IbrahimHP\Uninstall-IbrahimHP.ps1
```

## Regenerate Icon

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\IbrahimHP\Build-Icon.ps1
```
