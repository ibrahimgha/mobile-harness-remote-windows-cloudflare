import { useCallback, useEffect, useState } from "react";

export const voiceOrbThemes = {
  water: {
    label: "Water",
    asset: "/voice-orb-water-test.gif?v=04587e6f071c",
    poster: "/voice-orb-water-test-poster.png?v=04587e6f071c"
  },
  beach: {
    label: "Beach ride",
    asset: "/voice-orb-beach-ride.gif?v=844639ba1085",
    poster: "/voice-orb-beach-ride-poster.png?v=06401f5ed800"
  },
  trail: {
    label: "Trail ride",
    asset: "/voice-orb-trail-ride.gif?v=7b3536733462",
    poster: "/voice-orb-trail-ride-poster.png?v=48ddb244b703"
  },
  dream: {
    label: "Dream line",
    asset: "/voice-orb-dream-line.gif?v=6fa6b901590f",
    poster: "/voice-orb-dream-line-poster.png?v=1b6e0d65426e"
  },
  mongolia: {
    label: "Mongolia ride",
    asset: "/voice-orb-mongolia-ride.gif?v=e36b8a45e55f",
    poster: "/voice-orb-mongolia-ride-poster.png?v=ae02abd5eb99"
  },
  mojave: {
    label: "Mojave ride",
    asset: "/voice-orb-mojave-ride-playback.gif?v=8f157ee8b176",
    poster: "/voice-orb-mojave-ride-playback-poster.png?v=dcccb4a3f1ce"
  },
  cappadocia: {
    label: "Cappadocia ride",
    asset: "/voice-orb-cappadocia-ride.gif?v=da06e139c7fe",
    poster: "/voice-orb-cappadocia-ride-poster.png?v=39178ba3052b"
  },
  powder: {
    label: "Powder run",
    asset: "/voice-orb-powder-run.gif?v=d3a05b1ae423",
    poster: "/voice-orb-powder-run-poster.png?v=58fa5ad7c4fe"
  }
} as const;

// Keep the user's uncompromised master separate from the phone-sized playback asset.
// It is intentionally never requested by the recorder UI or shipped in deployments.
export const fullResolutionVoiceOrbThemes = {
  mojave: {
    label: "Mojave ride full resolution",
    asset: "/voice-orb-mojave-ride.gif?v=cf0b7f37af63",
    poster: "/voice-orb-mojave-ride-poster.png?v=3eb99c89aa34"
  }
} as const;

export type FixedVoiceOrbTheme = keyof typeof voiceOrbThemes;
export type VoiceOrbTheme = FixedVoiceOrbTheme | "random";

let lastRandomTheme: FixedVoiceOrbTheme | undefined;
export function resolveVoiceOrbTheme(theme: VoiceOrbTheme): FixedVoiceOrbTheme {
  if (theme !== "random") return theme;
  const choices = (Object.keys(voiceOrbThemes) as FixedVoiceOrbTheme[]).filter((key) => key !== lastRandomTheme);
  const selected = choices[Math.floor(Math.random() * choices.length)];
  lastRandomTheme = selected;
  return selected;
}

export function isVoiceOrbTheme(value: unknown): value is VoiceOrbTheme {
  return value === "random" || value === "water" || value === "beach" || value === "trail" || value === "dream" || value === "mongolia" || value === "mojave" || value === "cappadocia" || value === "powder";
}

export function voiceOrbThemeStorageKey(scope: string) {
  return `codex-voice-orb-theme-v1:${encodeURIComponent(scope || "default")}`;
}

function readTheme(key: string): VoiceOrbTheme {
  try {
    const value = localStorage.getItem(key);
    return isVoiceOrbTheme(value) ? value : "random";
  } catch {
    return "random";
  }
}

export function useVoiceOrbTheme(scope: string) {
  const key = voiceOrbThemeStorageKey(scope);
  const [theme, setTheme] = useState<VoiceOrbTheme>(() => readTheme(key));

  useEffect(() => {
    setTheme(readTheme(key));
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) setTheme(readTheme(key));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [key]);

  const selectTheme = useCallback((next: VoiceOrbTheme) => {
    setTheme(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Continue using the chosen animation if storage is unavailable.
    }
  }, [key]);

  return [theme, selectTheme] as const;
}
