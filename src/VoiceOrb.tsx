import { useEffect, useRef, useState, type RefObject } from "react";
import { voiceOrbThemes, resolveVoiceOrbTheme, type VoiceOrbTheme } from "./voiceOrbThemes";

export type VoiceAudioMetrics = {
  amplitude: number;
  bass: number;
  mid: number;
  treble: number;
  peak: number;
};

type VoiceOrbProps = {
  audioMetricsRef: RefObject<VoiceAudioMetrics>;
  phase: "starting" | "recording" | "processing";
  loadAnimatedAsset: boolean;
  theme?: VoiceOrbTheme;
};

// Keep the prior video-derived orb available for an instant rollback.
export const LEGACY_ORB_ASSET = "/voice-orb-video.gif?v=da9cace1bd46";
export const LEGACY_ORB_POSTER_ASSET = "/voice-orb-poster.png?v=da9cace1bd46";

export function VoiceOrb({ audioMetricsRef, phase, loadAnimatedAsset, theme = "water" }: VoiceOrbProps) {
  const reactorRef = useRef<HTMLDivElement | null>(null);
  const [loadedAsset, setLoadedAsset] = useState<string | null>(null);
  const [randomTheme] = useState(() => resolveVoiceOrbTheme(theme));
  const animation = voiceOrbThemes[theme === "random" ? randomTheme : theme];
  const assetLoaded = loadAnimatedAsset && loadedAsset === animation.asset;

  useEffect(() => {
    const reactor = reactorRef.current;
    if (!reactor) return;

    reactor.style.setProperty("--voice-mic-scale", "1");
    if (phase !== "recording") return;

    let animationFrame = 0;
    let lastUpdateAt = 0;

    const updateScale = (now: number) => {
      if (document.visibilityState === "visible" && now - lastUpdateAt >= 33) {
        const metrics = audioMetricsRef.current;
        const source = Math.max(metrics.amplitude * 1.3, metrics.peak * 0.9);
        const normalized = Math.min(1, Math.max(0, (source - 0.015) / 0.55));
        const target = Math.pow(normalized, 0.58);
        reactor.style.setProperty("--voice-mic-scale", (1 + target * 0.42).toFixed(4));
        lastUpdateAt = now;
      }

      animationFrame = window.requestAnimationFrame(updateScale);
    };

    animationFrame = window.requestAnimationFrame(updateScale);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [audioMetricsRef, phase]);

  return (
    <div ref={reactorRef} className="voice-orb-reactor" data-orb-theme={theme} aria-hidden="true">
      <img
        className={`voice-orb-poster is-circle-crop${assetLoaded ? " is-replaced" : ""}`}
        src={animation.poster}
        alt=""
        draggable={false}
      />
      {loadAnimatedAsset ? (
        <img
          key={animation.asset}
          className={`voice-orb-image is-circle-crop${assetLoaded ? " is-loaded" : ""}`}
          src={animation.asset}
          alt=""
          draggable={false}
          onLoad={() => setLoadedAsset(animation.asset)}
        />
      ) : null}
    </div>
  );
}
