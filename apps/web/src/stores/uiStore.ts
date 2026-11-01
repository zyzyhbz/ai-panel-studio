import { create } from "zustand";

export type MobileTab = "table" | "log" | "insights";
export type ReplaySpeed = 1 | 1.5 | 2;

const SPEED_KEY = "ai-panel.replay-speed";

function readSpeed(): ReplaySpeed {
  try {
    const raw = globalThis.localStorage?.getItem(SPEED_KEY);
    const value = Number(raw);
    if (value === 1 || value === 1.5 || value === 2) return value;
  } catch {
    /* private mode / no storage — fall through */
  }
  return 1;
}

function writeSpeed(speed: ReplaySpeed): void {
  try {
    globalThis.localStorage?.setItem(SPEED_KEY, String(speed));
  } catch {
    /* ignore */
  }
}

interface UiState {
  mobileTab: MobileTab;
  insightDrawerOpen: boolean;
  replaySpeed: ReplaySpeed;
  setMobileTab: (tab: MobileTab) => void;
  setInsightDrawerOpen: (open: boolean) => void;
  toggleInsightDrawer: () => void;
  setReplaySpeed: (speed: ReplaySpeed) => void;
}

export const useUiStore = create<UiState>((set) => ({
  mobileTab: "table",
  insightDrawerOpen: false,
  replaySpeed: readSpeed(),
  setMobileTab: (mobileTab) => set({ mobileTab }),
  setInsightDrawerOpen: (insightDrawerOpen) => set({ insightDrawerOpen }),
  toggleInsightDrawer: () =>
    set((state) => ({ insightDrawerOpen: !state.insightDrawerOpen })),
  setReplaySpeed: (replaySpeed) => {
    writeSpeed(replaySpeed);
    set({ replaySpeed });
  },
}));
