import { create } from "zustand";

export type ThemeId = "atelier" | "nocturne" | "paper";

export const THEMES: ReadonlyArray<{
  id: ThemeId;
  label: string;
  hint: string;
}> = [
  { id: "atelier", label: "Atelier", hint: "暖纸 · 胡桃木 · 朱砂（默认）" },
  { id: "nocturne", label: "Nocturne", hint: "深蓝灰 · 烟灰 · 琥珀" },
  { id: "paper", label: "Paper & Ink", hint: "纸白 · 鼠尾草 · 钴蓝" },
];

const STORAGE_KEY = "ai-panel.theme";
const DEFAULT_THEME: ThemeId = "atelier";

function isTheme(value: unknown): value is ThemeId {
  return value === "atelier" || value === "nocturne" || value === "paper";
}

function readTheme(): ThemeId {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (isTheme(raw)) return raw;
  } catch {
    /* private mode */
  }
  return DEFAULT_THEME;
}

/** Applies the theme to `<html data-theme>`; CSS variables do the rest. */
export function applyTheme(theme: ThemeId): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
}

interface ThemeState {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  theme: readTheme(),
  setTheme: (theme) => {
    applyTheme(theme);
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
    set({ theme });
  },
}));

/** Called once at boot, before React renders, to avoid a flash of the wrong palette. */
export function bootstrapTheme(): void {
  applyTheme(readTheme());
}
