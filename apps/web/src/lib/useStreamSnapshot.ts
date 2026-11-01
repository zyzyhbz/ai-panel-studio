import { useSyncExternalStore } from "react";

import type { StreamBuffer, StreamSnapshot } from "../domain/streamBuffer";

/**
 * Subscribes ONE component to the live streaming text. The transcript list,
 * the rail and the insight panel never re-render on token arrival.
 */
export function useStreamSnapshot(buffer: StreamBuffer): StreamSnapshot | null {
  return useSyncExternalStore(buffer.subscribe, buffer.getSnapshot, () => null);
}

/**
 * Coarse view of the buffer for components that only need "is someone
 * talking". Returns primitives, so React bails out on every token and the
 * consumer re-renders only when a message starts or finishes.
 */
export function useStreamingFlags(buffer: StreamBuffer): {
  messageId: string | null;
  hasText: boolean;
} {
  const messageId = useSyncExternalStore(
    buffer.subscribe,
    () => buffer.getSnapshot()?.messageId ?? null,
    () => null,
  );
  const hasText = useSyncExternalStore(
    buffer.subscribe,
    () => (buffer.getSnapshot()?.accepted.length ?? 0) > 0,
    () => false,
  );
  return { messageId, hasText };
}
