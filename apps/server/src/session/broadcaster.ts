export interface BroadcastFrame {
  /** null for ephemeral frames (stream.ready, message.delta, error, ...). */
  seq: number | null;
  type: string;
  /** Exact JSON string to write as the SSE `data:` field. */
  dataJson: string;
}

interface Subscriber {
  id: number;
  /** Non-null while replaying: frames are queued here instead of written. */
  buffering: BroadcastFrame[] | null;
  overflowed: boolean;
  deliver: (frame: BroadcastFrame) => void;
  onClose?: () => void;
}

export interface Subscription {
  readonly id: number;
  /** Flush buffered frames and switch to live mode. Returns true if overflowed. */
  goLive(): boolean;
  isLive(): boolean;
  unsubscribe(): void;
}

const BUFFER_CAP = 1_000;

export interface Broadcaster {
  subscribe(
    discussionId: string,
    deliver: (frame: BroadcastFrame) => void,
    onClose?: () => void,
  ): Subscription;
  emitPersisted(discussionId: string, frame: BroadcastFrame): void;
  emitEphemeral(discussionId: string, type: string, payload: unknown): void;
  count(): number;
  countFor(discussionId: string): number;
  closeSession(discussionId: string): void;
  closeAll(): void;
}

/**
 * Per-session fan-out. Frames are written synchronously in seq order because
 * `emitPersisted` is called from the same synchronous stack that persisted them.
 *
 * Subscribe-then-replay-then-flush is the contract: a subscriber starts in
 * buffering mode, the route replays history from SQLite, then calls goLive().
 * Because replay is synchronous (no await), the buffer is normally empty — the
 * mechanism is a safety net, not the primary path.
 */
export function createBroadcaster(): Broadcaster {
  const sessions = new Map<string, Set<Subscriber>>();
  let nextId = 1;
  let total = 0;

  function detach(discussionId: string, sub: Subscriber): void {
    const set = sessions.get(discussionId);
    if (!set) return;
    if (set.delete(sub)) total -= 1;
    if (set.size === 0) sessions.delete(discussionId);
    try {
      sub.onClose?.();
    } catch {
      /* cleanup must never throw */
    }
  }

  function subscribe(
    discussionId: string,
    deliver: (frame: BroadcastFrame) => void,
    onClose?: () => void,
  ): Subscription {
    const sub: Subscriber = {
      id: nextId++,
      buffering: [],
      overflowed: false,
      deliver,
      onClose,
    };
    let set = sessions.get(discussionId);
    if (!set) {
      set = new Set();
      sessions.set(discussionId, set);
    }
    set.add(sub);
    total += 1;

    return {
      id: sub.id,
      isLive: () => sub.buffering === null,
      goLive(): boolean {
        const buffered = sub.buffering ?? [];
        sub.buffering = null;
        for (const frame of buffered) {
          if (sub.overflowed) break;
          sub.deliver(frame);
        }
        return sub.overflowed;
      },
      unsubscribe(): void {
        detach(discussionId, sub);
      },
    };
  }

  return {
    subscribe,

    emitPersisted(discussionId: string, frame: BroadcastFrame): void {
      const set = sessions.get(discussionId);
      if (!set) return;
      for (const sub of [...set]) {
        if (sub.buffering) {
          if (sub.buffering.length >= BUFFER_CAP) {
            sub.overflowed = true;
            sub.buffering = null; // let the route close and let the client re-sync
            continue;
          }
          sub.buffering.push(frame);
        } else {
          sub.deliver(frame);
        }
      }
    },

    /**
     * Token deltas and other non-persisted frames. Dropped while a subscriber is
     * still replaying: deltas are reconstructible from message.completed, the
     * reverse is not (BACKEND-PLAN §1.3 D3).
     */
    emitEphemeral(discussionId: string, type: string, payload: unknown): void {
      const set = sessions.get(discussionId);
      if (!set) return;
      const dataJson = JSON.stringify(payload);
      const frame: BroadcastFrame = { seq: null, type, dataJson };
      for (const sub of [...set]) {
        if (sub.buffering) continue;
        sub.deliver(frame);
      }
    },

    count(): number {
      return total;
    },

    countFor(discussionId: string): number {
      return sessions.get(discussionId)?.size ?? 0;
    },

    closeSession(discussionId: string): void {
      const set = sessions.get(discussionId);
      if (!set) return;
      for (const sub of [...set]) detach(discussionId, sub);
    },

    closeAll(): void {
      for (const discussionId of [...sessions.keys()]) {
        this.closeSession(discussionId);
      }
    },
  };
}
