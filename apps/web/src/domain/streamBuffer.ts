/**
 * StreamBuffer — the only place where token-level text lives.
 *
 * It is deliberately OUTSIDE React and outside every global store: a 120-char
 * message arrives as 25–40 deltas, and dispatching each one would re-render the
 * transcript, the rail and the insight panel on every token.
 *
 * The buffer also paces the *reveal* so text looks like speech instead of
 * appearing as a wall. `prefers-reduced-motion` reveals everything at once.
 */

export interface StreamSnapshot {
  messageId: string;
  speakerId: string;
  /** Text currently revealed on screen. */
  text: string;
  /** Full text accepted so far (may lead `text` by a few characters). */
  accepted: string;
  started: boolean;
}

const FRAME_MS = 16;
/** Fraction of the backlog drained per frame. Keeps short messages legible
 *  and long ones from lagging behind. */
const DRAIN_RATIO = 0.18;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/** Slice without splitting a surrogate pair. */
function safeSlice(value: string, end: number): string {
  if (end <= 0) return "";
  if (end >= value.length) return value;
  const code = value.charCodeAt(end - 1);
  return value.slice(0, isHighSurrogate(code) ? end - 1 : end);
}

export class StreamBuffer {
  private messageId: string | null = null;
  private speakerId: string | null = null;
  private accepted = "";
  private revealed = "";
  private snapshot: StreamSnapshot | null = null;
  private readonly listeners = new Set<() => void>();
  private handle: number | null = null;
  private reducedMotion = false;

  setReducedMotion(value: boolean): void {
    this.reducedMotion = value;
    if (value) this.flushImmediately();
  }

  /** Called on `turn.started` — reserves the slot before the first token. */
  begin(messageId: string, speakerId: string): void {
    if (this.messageId === messageId) return;
    this.cancel();
    this.messageId = messageId;
    this.speakerId = speakerId;
    this.accepted = "";
    this.revealed = "";
    this.publish();
  }

  append(messageId: string, delta: string): void {
    if (!delta) return;
    if (this.messageId === null) {
      this.messageId = messageId;
      this.speakerId = "";
    }
    if (this.messageId !== messageId) {
      // A new message started without a turn.started we saw (e.g. after a
      // reconnect). Adopt it rather than dropping tokens on the floor.
      this.messageId = messageId;
      this.accepted = "";
      this.revealed = "";
    }
    this.accepted += delta;
    this.schedule();
  }

  /** `message.completed` — the authoritative text wins, then we hand off. */
  complete(messageId: string): void {
    if (this.messageId !== messageId) return;
    this.cancel();
    this.accepted = "";
    this.revealed = "";
    this.messageId = null;
    this.speakerId = null;
    this.publish();
  }

  /** Reconnect timer fired / turn aborted / unmount: half a sentence is worse
   *  than none, and the completed message will arrive in full. */
  clear(): void {
    this.cancel();
    this.accepted = "";
    this.revealed = "";
    this.messageId = null;
    this.speakerId = null;
    this.publish();
  }

  getSnapshot = (): StreamSnapshot | null => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Test seam — drains the animation without waiting for a frame. */
  flushImmediately(): void {
    this.cancel();
    if (this.accepted !== this.revealed) {
      this.revealed = this.accepted;
      this.publish();
    }
  }

  dispose(): void {
    this.cancel();
    this.listeners.clear();
    this.snapshot = null;
  }

  private schedule(): void {
    if (this.reducedMotion) {
      this.flushImmediately();
      return;
    }
    if (this.handle !== null) return;
    const run = () => {
      this.handle = null;
      this.step();
    };
    this.handle =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame(run)
        : (setTimeout(run, FRAME_MS) as unknown as number);
  }

  private cancel(): void {
    if (this.handle === null) return;
    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.handle);
    }
    clearTimeout(this.handle as unknown as ReturnType<typeof setTimeout>);
    this.handle = null;
  }

  private step(): void {
    const pending = this.accepted.length - this.revealed.length;
    if (pending <= 0) {
      if (this.revealed !== this.accepted) {
        this.revealed = this.accepted;
        this.publish();
      }
      return;
    }
    const step = Math.max(1, Math.ceil(pending * DRAIN_RATIO));
    this.revealed = safeSlice(this.accepted, this.revealed.length + step);
    this.publish();
    if (this.revealed.length < this.accepted.length) this.schedule();
  }

  private publish(): void {
    if (this.messageId === null) {
      this.snapshot = null;
    } else {
      this.snapshot = {
        messageId: this.messageId,
        speakerId: this.speakerId ?? "",
        text: this.revealed,
        accepted: this.accepted,
        started: this.accepted.length > 0,
      };
    }
    for (const listener of this.listeners) listener();
  }
}
