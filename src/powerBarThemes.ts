import { useCallback, useEffect, useState } from "react";

export const powerBarThemes = {
  water: {
    label: "Blue / water",
    solid: "#1594e8",
    middle: "rgba(21, 148, 232, 0.32)",
    faded: "rgba(21, 148, 232, 0.08)",
    shade: "rgba(0, 24, 32, 0.1)",
    asset: "/voice-orb-water-test.gif?v=04587e6f071c"
  },
  // Keep the persisted key so existing yellow squares receive the replacement.
  wheat: {
    label: "Yellow / amber",
    solid: "#eab308",
    middle: "rgba(234, 179, 8, 0.32)",
    faded: "rgba(234, 179, 8, 0.08)",
    shade: "rgba(38, 28, 4, 0.1)",
    asset: "/model-bar-amber.gif?v=8d675e15e8b5"
  },
  fire: {
    label: "Red / fire",
    solid: "#e53935",
    middle: "rgba(229, 57, 53, 0.32)",
    faded: "rgba(229, 57, 53, 0.08)",
    shade: "rgba(40, 6, 0, 0.1)",
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
  const { solid, middle, faded } = powerBarThemes[theme];
  // Keep Sol Low solid, then reveal the animation strongly by Sol High.
  return `linear-gradient(to right, ${solid} ${opaqueEnd}, ${middle} 60%, ${faded} 100%)`;
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
