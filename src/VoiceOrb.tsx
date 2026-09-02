import { useEffect, useRef, useState, type RefObject } from "react";

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
};

// Keep the prior video-derived orb available for an instant rollback after
// this water-orb visual test.
export const LEGACY_ORB_ASSET = "/voice-orb-video.gif?v=da9cace1bd46";
export const LEGACY_ORB_POSTER_ASSET = "/voice-orb-poster.png?v=da9cace1bd46";
const ORB_ASSET = "/voice-orb-water-test.gif?v=04587e6f071c";
const ORB_POSTER_ASSET = "/voice-orb-water-test-poster.png?v=04587e6f071c";

export function VoiceOrb({ audioMetricsRef, phase, loadAnimatedAsset }: VoiceOrbProps) {
  const reactorRef = useRef<HTMLDivElement | null>(null);
  const [assetLoaded, setAssetLoaded] = useState(false);

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
    <div ref={reactorRef} className="voice-orb-reactor" aria-hidden="true">
      <img
        className={`voice-orb-poster is-circle-crop${assetLoaded ? " is-replaced" : ""}`}
        src={ORB_POSTER_ASSET}
        alt=""
        draggable={false}
      />
      {loadAnimatedAsset ? (
        <img
          className={`voice-orb-image is-circle-crop${assetLoaded ? " is-loaded" : ""}`}
          src={ORB_ASSET}
          alt=""
          draggable={false}
          onLoad={() => setAssetLoaded(true)}
        />
      ) : null}
    </div>
  );
}
