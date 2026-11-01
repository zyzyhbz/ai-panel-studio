import { THEMES, useThemeStore } from "../stores/themeStore";
import { cn } from "../lib/cn";

const SWATCH: Record<string, string> = {
  atelier: "linear-gradient(135deg,#f2eee6 0 55%,#8b6b4a 55% 78%,#c8553d 78%)",
  nocturne: "linear-gradient(135deg,#101418 0 55%,#5c7189 55% 78%,#d97745 78%)",
  paper: "linear-gradient(135deg,#f7f4ee 0 55%,#8a9a8b 55% 78%,#2456a6 78%)",
};

/**
 * Palette switcher. Pure UI affordance for comparing the three schemes from
 * docs/09 §2 — it never touches discussion state.
 */
export function ThemeSwitcher() {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);

  return (
    <div
      role="group"
      aria-label="配色方案"
      data-testid="theme-switcher"
      className="flex shrink-0 items-center gap-0.5 rounded-md border border-line-1 p-0.5"
    >
      {THEMES.map((option) => {
        const selected = theme === option.id;
        return (
          <button
            key={option.id}
            type="button"
            title={`${option.label} · ${option.hint}`}
            aria-pressed={selected}
            data-testid={`theme-${option.id}`}
            onClick={() => setTheme(option.id)}
            className={cn(
              "flex h-6 items-center gap-1 rounded-sm px-1.5 text-[10px] transition-colors",
              selected
                ? "bg-stage-800 font-semibold text-ink-1"
                : "text-ink-4 hover:text-ink-2",
            )}
          >
            <span
              aria-hidden
              className="size-2.5 rounded-full border border-line-2"
              style={{ background: SWATCH[option.id] }}
            />
            <span className="hidden xl:inline">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
