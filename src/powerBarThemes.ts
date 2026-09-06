import { useCallback, useEffect, useState } from "react";

export const powerBarThemes = {
  water: {
    label: "Blue / water",
    solid: "#1594e8",
    faded: "rgba(21, 148, 232, 0.35)",
    shade: "rgba(0, 24, 32, 0.38)",
    asset: "/voice-orb-water-test.gif?v=04587e6f071c"
  },
  wheat: {
    label: "Yellow / wheat",
    solid: "#eab308",
    faded: "rgba(234, 179, 8, 0.35)",
    shade: "rgba(38, 28, 4, 0.22)",
    asset: "/model-bar-wheat.gif?v=0ecf18702746"
  },
  fire: {
    label: "Red / fire",
    solid: "#e53935",
    faded: "rgba(229, 57, 53, 0.35)",
    shade: "rgba(40, 6, 0, 0.28)",
    asset: "/model-bar-fire.gif?v=796241ddaa99"
  }
} as const;

export type PowerBarTheme = keyof typeof powerBarThemes;

export function isPowerBarTheme(value: unknown): value is PowerBarTheme {
  return value === "water" || value === "wheat" || value === "fire";
}

export function powerBarTexture(theme: PowerBarTheme) {
  const { shade, asset } = powerBarThemes[theme];
  return `linear-gradient(${shade}, ${shade}), url("${asset}")`;
}

export function powerBarTint(theme: PowerBarTheme, opaqueEnd: string) {
  const { solid, faded } = powerBarThemes[theme];
  return `linear-gradient(to right, ${solid} ${opaqueEnd}, ${faded} 100%)`;
}

function readTheme(key: string): PowerBarTheme {
  try {
    const value = localStorage.getItem(key);
    return isPowerBarTheme(value) ? value : "water";
  } catch {
    return "water";
  }
}

export function usePowerBarTheme(scope: string) {
  const key = `codex-power-bar-theme-v1:${encodeURIComponent(scope || "default")}`;
  const [theme, setTheme] = useState<PowerBarTheme>(() => readTheme(key));

  useEffect(() => {
    setTheme(readTheme(key));
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setTheme(readTheme(key));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  const selectTheme = useCallback((next: PowerBarTheme) => {
    setTheme(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Keep the choice usable for this visit if browser storage is unavailable.
    }
  }, [key]);

  return [theme, selectTheme] as const;
}
