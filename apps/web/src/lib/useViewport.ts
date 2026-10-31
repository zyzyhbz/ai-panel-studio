import { useEffect, useState } from "react";

export type Viewport = "mobile" | "tablet" | "desktop" | "wide";

const QUERIES: Array<{ key: Exclude<Viewport, "desktop">; query: string }> = [
  { key: "mobile", query: "(max-width: 767px)" },
  { key: "tablet", query: "(min-width: 768px) and (max-width: 1023px)" },
  { key: "wide", query: "(min-width: 1440px)" },
];

function read(): Viewport {
  if (typeof window === "undefined" || !window.matchMedia) return "desktop";
  if (window.matchMedia(QUERIES[0].query).matches) return "mobile";
  if (window.matchMedia(QUERIES[1].query).matches) return "tablet";
  if (window.matchMedia(QUERIES[2].query).matches) return "wide";
  return "desktop";
}

/**
 * Structural breakpoints. Layout *sizes* stay in CSS; only the things that
 * change the DOM (which panel is a tab, whether the insight panel is a drawer)
 * are decided here. Everything degrades to "desktop" when matchMedia is
 * missing (jsdom, SSR).
 */
export function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(read);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const lists = QUERIES.map((entry) => window.matchMedia(entry.query));
    const onChange = () => setViewport(read());
    for (const list of lists) list.addEventListener("change", onChange);
    onChange();
    return () => {
      for (const list of lists) list.removeEventListener("change", onChange);
    };
  }, []);

  return viewport;
}
