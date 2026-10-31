import { useSyncExternalStore } from "react";

import type { StreamBuffer, StreamSnapshot } from "../domain/streamBuffer";

/**
 * Subscribes ONE component to the live streaming text. The transcript list,
 * the rail and the insight panel never re-render on token arrival.
 */
export function useStreamSnapshot(buffer: StreamBuffer): StreamSnapshot | null {
  return useSyncExternalStore(buffer.subscribe, buffer.getSnapshot, () => null);
}
