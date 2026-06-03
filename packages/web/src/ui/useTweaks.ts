import { useEffect, useState } from "react";
import type { AccentKey, Density } from "./theme";

// =============================================================================
// µ — UI tweaks, persisted to localStorage so a reload keeps your surface.
// =============================================================================

export interface Tweaks {
  dark: boolean;
  accent: AccentKey;
  density: Density;
  chatWidth: number;
}

const DEFAULTS: Tweaks = { dark: false, accent: "konruri", density: "regular", chatWidth: 380 };
const KEY = "mu.tweaks";

function load(): Tweaks {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Tweaks>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function useTweaks(): [Tweaks, <K extends keyof Tweaks>(k: K, v: Tweaks[K]) => void] {
  const [tweaks, setTweaks] = useState<Tweaks>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(tweaks));
    } catch {
      /* ignore quota / privacy-mode errors */
    }
  }, [tweaks]);
  const set = <K extends keyof Tweaks>(k: K, v: Tweaks[K]): void => setTweaks((prev) => ({ ...prev, [k]: v }));
  return [tweaks, set];
}
