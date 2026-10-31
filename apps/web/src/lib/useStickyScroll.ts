import { useCallback, useEffect, useRef, useState } from "react";

const PIN_THRESHOLD = 80;

export interface StickyScroll {
  ref: React.RefObject<HTMLDivElement | null>;
  /** True when the viewport is glued to the bottom. */
  pinned: boolean;
  /** Messages that arrived while the user was scrolled up. */
  unread: number;
  /** User explicitly pressed "pause auto scroll". */
  paused: boolean;
  jumpToLatest: () => void;
  togglePause: () => void;
  /** Call after the transcript content changes. */
  notifyContent: () => void;
}

/**
 * Transcript stick-to-bottom behaviour.
 *
 * Rules (FR-08):
 *  - within 80px of the bottom → pinned, new messages are appended in place;
 *  - scrolled further up → pause and surface "jump to latest" + unread count;
 *  - explicit pause wins over pinning;
 *  - `behavior: "auto"` while pinned (smooth on every append is janky);
 *    smooth only for the explicit jump.
 */
export function useStickyScroll(reducedMotion: boolean): StickyScroll {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pinned, setPinned] = useState(true);
  const [unread, setUnread] = useState(0);
  const [paused, setPaused] = useState(false);

  const pinnedRef = useRef(true);
  const pausedRef = useRef(false);
  const mountedRef = useRef(false);

  pinnedRef.current = pinned;
  pausedRef.current = paused;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      const next = distance < PIN_THRESHOLD;
      if (next !== pinnedRef.current) {
        pinnedRef.current = next;
        setPinned(next);
        if (next) setUnread(0);
      }
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  const notifyContent = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    // Skip the very first paint: nothing "new" has arrived yet.
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }

    if (pinnedRef.current && !pausedRef.current) {
      el.scrollTop = el.scrollHeight;
      return;
    }

    setUnread((n) => n + 1);
  }, []);

  const jumpToLatest = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: reducedMotion ? "auto" : "smooth",
    });
    pinnedRef.current = true;
    setPinned(true);
    setUnread(0);
  }, [reducedMotion]);

  const togglePause = useCallback(() => {
    setPaused((prev) => {
      const next = !prev;
      if (!next) {
        const el = ref.current;
        if (el) el.scrollTop = el.scrollHeight;
        setUnread(0);
        pinnedRef.current = true;
        setPinned(true);
      }
      return next;
    });
  }, []);

  return { ref, pinned, unread, paused, jumpToLatest, togglePause, notifyContent };
}

/** Ticking clock for the live header. Returns `Date.now()` every second. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  return now;
}
