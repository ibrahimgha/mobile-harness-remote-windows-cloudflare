# seo-man Windows App

This folder contains a lightweight Windows app wrapper for:

https://mobile-harness-remote-windows-cloudflare-vm13.bit68-infra.com/

It installs a Start Menu shortcut named **seo-man** and, by default, a Desktop shortcut. The shortcut opens Microsoft Edge or Google Chrome in app mode and uses the custom `seo-man.ico` icon.

## Install

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\SeoMan\Install-SeoMan.ps1
```

## Install Without Desktop Shortcut

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\SeoMan\Install-SeoMan.ps1 -NoDesktopShortcut
```

## Uninstall

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\SeoMan\Uninstall-SeoMan.ps1
```

## Regenerate Icon

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File windows\SeoMan\Build-Icon.ps1
```
