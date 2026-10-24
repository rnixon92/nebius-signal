import { useEffect, useState } from "react";

// Chart palette: the validated reference categorical order, stepped separately for each mode.
const SERIES = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};

// Validated against these surfaces (navy #072233 dark, white light) with the dataviz palette checker.
// `accent` is the single-series color: brand lime on navy, deep navy on light. Multi-series charts
// always use the categorical `series` order instead.
const CHROME = {
  light: { surface: "#ffffff", ink: "#052b42", ink2: "#3d5568", ink3: "#6b7f8e", grid: "#e3e8f0", rule: "#c5cfdb", other: "#c5cfdb", muted: "#d9e0ea", accent: "#0b4a6e" },
  dark: { surface: "#072233", ink: "#eef3f7", ink2: "#b2c3d0", ink3: "#7590a3", grid: "#10324a", rule: "#1e4a66", other: "#3a5a70", muted: "#1b4058", accent: "#d4f43e" },
};

export type Mode = "light" | "dark";
export type Palette = (typeof CHROME)["light"] & { series: string[]; mode: Mode };

export const paletteFor = (mode: Mode): Palette => ({ ...CHROME[mode], series: SERIES[mode], mode });

/** Fixed slot per GPU family so a family keeps its color across every chart and filter. */
export const GPU_SLOT: Record<string, number> = { B300: 0, B200: 1, H200: 2, H100: 3, "RTX PRO 6000": 4, GB300: 5, GB200: 6, L40S: 7 };

export type ThemePref = "system" | Mode;

function systemMode(): Mode {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem("theme");
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(readPref);
  const [system, setSystem] = useState<Mode>(systemMode);

  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setSystem(mq.matches ? "dark" : "light");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (pref === "system") delete root.dataset.theme;
    else root.dataset.theme = pref;
    try {
      if (pref === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", pref);
    } catch {
      // storage unavailable (private mode); the choice still applies for this visit
    }
  }, [pref]);

  const mode = pref === "system" ? system : pref;
  return { pref, setPref, mode, palette: paletteFor(mode) };
}
