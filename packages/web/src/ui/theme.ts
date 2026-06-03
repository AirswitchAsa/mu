import type { RenderTheme } from "../renderers/types";

// =============================================================================
// µ — theme. Ports applyTheme/ACCENTS from the mockup and reads the live CSS
// custom properties into a RenderTheme the chart plugins consume.
// =============================================================================

export type AccentKey = "konruri" | "seiheki" | "sumi";
export type Density = "compact" | "regular" | "comfy";

interface AccentPair {
  light: { action: string; ink: string; soft: string };
  dark: { action: string; ink: string; soft: string };
}

// paired light/dark; "konruri" = system default (no override)
export const ACCENTS: Record<AccentKey, AccentPair | null> = {
  konruri: null,
  seiheki: {
    light: { action: "#478384", ink: "#ffffff", soft: "#d7e4e4" },
    dark: { action: "#38b48b", ink: "#2b2b2b", soft: "#3a5f54" },
  },
  sumi: {
    light: { action: "#2b2b2b", ink: "#ffffff", soft: "#e0dfdf" },
    dark: { action: "#fffffc", ink: "#2b2b2b", soft: "#4a4a4a" },
  },
};

export function applyTheme(dark: boolean, accent: AccentKey, density: Density): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", dark ? "dark" : "light");
  root.setAttribute("data-density", density);
  const a = ACCENTS[accent];
  if (!a) {
    root.style.removeProperty("--action");
    root.style.removeProperty("--action-ink");
    root.style.removeProperty("--action-soft");
    root.style.removeProperty("--info");
  } else {
    const p = dark ? a.dark : a.light;
    root.style.setProperty("--action", p.action);
    root.style.setProperty("--action-ink", p.ink);
    root.style.setProperty("--action-soft", p.soft);
    root.style.setProperty("--info", p.action);
  }
}

/** Read the design-system CSS vars into a RenderTheme for the chart plugins. */
export function readTheme(): RenderTheme {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string): string => cs.getPropertyValue(n).trim();
  return {
    paper: v("--paper"),
    ink: v("--ink"),
    inkSoft: v("--ink-soft"),
    muted: v("--muted"),
    line: v("--line"),
    lineStrong: v("--line-strong"),
    action: v("--action"),
    system: v("--system"),
    danger: v("--danger"),
    favorite: v("--favorite"),
    fontMono: v("--ds-font-mono") || "monospace",
  };
}
