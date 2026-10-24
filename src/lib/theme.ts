import { useEffect, useState } from "react";

// Chart palette: the validated reference categorical order, stepped separately for each mode.
const SERIES = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};

const CHROME = {
  light: { surface: "#fcfcfb", ink: "#0b0b0b", ink2: "#52514e", ink3: "#898781", grid: "#e1e0d9", rule: "#c3c2b7", other: "#c3c2b7", muted: "#d6d5cf" },
  dark: { surface: "#1a1a19", ink: "#f0efec", ink2: "#c3c2b7", ink3: "#898781", grid: "#2c2c2a", rule: "#383835", other: "#5a5955", muted: "#3a3a37" },
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
