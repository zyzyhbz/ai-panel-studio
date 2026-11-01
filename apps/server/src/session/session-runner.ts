import type { ExpertPersona, TurnDecision } from "@ai-panel/agent";
import {
  buildEligibility,
  closingIntent,
  parseDecisionOutput,
  sanitizeDecision,
  selectFallbackSpeaker,
  validateSpeech,
  type DiscussionSnapshot,
  type Eligibility,
} from "@ai-panel/agent";
import type { CoreDeps } from "../context";
import { toMessageDto } from "../http/serializers";
import { buildDecisionPrompt, buildSpeechPrompt } from "../llm/prompts";
import { LlmError, type MockScenario } from "../llm/types";
import { combineSignals } from "../lib/abort";
import { prefixedId } from "../lib/ids";
import { projectSnapshot } from "./project";
import { fallbackSpeechFor } from "../services/speech.util";
import type { InsightService } from "../services/insight.service";

export type StopReason = "user" | "auto" | "shutdown" | "watchdog";

export interface SessionRunnerDeps extends CoreDeps {
  insights: InsightService;
}

export class SessionRunner {
  private stopRequested = false;
  private stopReason: StopReason = "auto";
  private readonly abort = new AbortController();
  private resolveSettled: (() => void) | null = null;
  private readonly settledPromise: Promise<void>;
  lastProgressAt = Date.now();
  private turnsRun = 0;
  private graceTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly deps: SessionRunnerDeps,
    readonly discussionId: string,
  ) {
    this.settledPromise = new Promise((resolve) => {
      this.resolveSettled = resolve;
    });
  }

  get finishReason(): StopReason {
    return this.stopReason;
  }

  get isStopped(): boolean {
    return this.stopRequested;
  }

  requestStop(reason: StopReason): void {
    this.stopRequested = true;
    this.stopReason = reason;

    // `/end` grants a short grace window so the utterance already on the wire can
    // finish instead of being cut into a half message (contract: 3s grace).
    // Shutdown/watchdog abort immediately — there is nobody left to read it.
    if (reason === "user" && this.deps.config.session.endGraceMs > 0) {
      this.graceTimer = setTimeout(() => {
        this.abort.abort(new Error("session stop: grace expired"));
      }, this.deps.config.session.endGraceMs);
      this.graceTimer.unref?.();
      return;
    }
    this.abort.abort(new Error(`session stop: ${reason}`));
  }

  private clearGrace(): void {
    if (this.graceTimer) {
      clearTimeout(this.graceTimer);
      this.graceTimer = null;
    }
  }

  settled(): Promise<void> {
    return this.settledPromise;
  }

  async run(): Promise<void> {
    try {
      await this.loop();
    } finally {
      this.clearGrace();
      this.resolveSettled?.();
      this.resolveSettled = null;
    }
  }

  private scenario(): MockScenario {
    const discussion = this.deps.repos.discussions.getById(this.discussionId);
    return (discussion?.qaScenario as MockScenario | null) ?? "normal";
  }

  private async loop(): Promise<void> {
    for (let guard = 0; guard < 64; guard += 1) {
      if (this.stopRequested) return;
      const snapshot = projectSnapshot(this.deps.repos, this.discussionId);
      if (!snapshot || snapshot.status !== "live") return;
      // Hard cap (36): a safety net above the soft target. Eligibility drives the
      // normal close; this only guarantees we can never run past the ceiling.
      if (snapshot.turnCount >= snapshot.maxTurns) return;

      const eligibility = buildEligibility(snapshot);
      const decision = await this.decide(snapshot, eligibility);
      if (!decision) return;

      const completed = await this.executeTurn(snapshot, eligibility, decision);
      if (!completed) return;
      // The in-flight turn landed inside the grace window: nothing left to abort.
      this.clearGrace();

      this.turnsRun += 1;
      this.lastProgressAt = Date.now();
      if (this.turnsRun % 2 === 0) {
        this.deps.insights.notify(this.discussionId, this.scenario());
      }
      // Terminal turn: the host said its closing piece, or the policy forced the
      // close. Closing is driven by argument saturation after the coverage floor
      // and before the 36 ceiling — never by a turn target. The loop only trusts
      // `action: "close"` here, so an expert can never end the session.
      if (eligibility.mustClose || isTerminalTurn(decision)) return;
    }
  }

  /* ------------------------------------------------------------- deciding */

  private async decide(
    snapshot: DiscussionSnapshot,
    eligibility: Eligibility,
  ): Promise<TurnDecision | null> {
    // Forced turns (opening / close / coverage) need no model call: the policy has
    // already picked the speaker, so asking again would only add latency.
    if (eligibility.forcedSpeakerId) {
      const speaker = snapshot.experts.find((e) => e.id === eligibility.forcedSpeakerId);
      if (!speaker) return null;
      const intent = eligibility.mustClose
        ? closingIntent()
        : eligibility.forcedReason === "opening"
          ? "opening"
          : "extend";
      const forced: TurnDecision = {
        speakerId: speaker.id,
        intent,
        turnFocus:
          intent === "opening"
            ? "开场点题"
            : intent === "summary"
              ? "收尾与共识"
              : speaker.focusArea.slice(0, 20),
      };
      if (intent === "summary") forced.action = "close";
      return forced;
    }

    try {
      const prompt = buildDecisionPrompt({ snapshot, eligibility });
      const result = await this.deps.llm.json({
        prompt,
        signal: combineSignals([
          this.abort.signal,
          AbortSignal.timeout(this.deps.config.llm.timeouts.decision),
        ]),
        timeoutMs: prompt.timeoutMs ?? this.deps.config.llm.timeouts.decision,
        parse: parseDecisionOutput,
        meta: {
          discussionId: this.discussionId,
          scenario: this.scenario(),
          turnIndex: snapshot.turnCount + 1,
          expertCount: snapshot.expertCount,
          roster: snapshot.experts.map((e) => ({ id: e.id, role: e.role, name: e.name })),
          candidates: snapshot.experts.map((e) => ({
            id: e.id,
            name: e.name,
            role: e.role,
            intent: intentForPolarity(e),
            polarity: e.polarity,
          })),
          topic: snapshot.topic,
          messageIds: snapshot.messages.map((m) => m.id),
        },
      });
      const sanitized = sanitizeDecision(result.value, snapshot, eligibility);
      if (sanitized.issues.length > 0) {
        this.deps.log.info(
          { discussionId: this.discussionId, issues: sanitized.issues.map((i) => i.code) },
          "decision repaired",
        );
      }
      // Policy owns the close decision: `sanitizeDecision` only emits `action: "close"`
      // when eligibility says the debate is saturated (or at the 36 ceiling). A model
      // that asks to close earlier is recorded as CLOSE_NOT_ALLOWED and ignored here —
      // otherwise a single turn could end a debate that is still productive.
      return this.normalizeClosingDecision(sanitized.decision, snapshot);
    } catch (error) {
      // AGENT-API §5.2: never retry the decision; use the deterministic fallback.
      const kind = error instanceof LlmError ? error.kind : "unknown";
      this.deps.log.warn(
        { discussionId: this.discussionId, kind },
        "decision failed; using fallback speaker",
      );
      const fallback = selectFallbackSpeaker(snapshot, eligibility);
      return fallback.decision
        ? this.normalizeClosingDecision(fallback.decision, snapshot)
        : null;
    }
  }

  /**
   * The host is the only one who may close, and closing means a `summary` turn.
   *
   * Two shapes can arrive here:
   * - policy `mustClose` (saturation or the 36 ceiling) already forced host+summary;
   * - the model proposes `action: "close"` (or a `summary` intent) earlier — then we
   *   re-point it at the host, so an expert can never "close" the panel.
   *
   * Result always carries `action: "close"`, which is the only thing the loop trusts.
   */
  private normalizeClosingDecision(
    decision: TurnDecision,
    snapshot: DiscussionSnapshot,
  ): TurnDecision {
    if (!isClosingSignal(decision)) return decision;
    const host = snapshot.experts.find((e) => e.role === "host");
    if (!host) return { ...decision, action: "next" };
    if (decision.speakerId === host.id && decision.intent === "summary") {
      return { ...decision, action: "close" };
    }
    return {
      speakerId: host.id,
      intent: closingIntent(),
      turnFocus: "收尾与共识",
      action: "close",
    };
  }

  /* --------------------------------------------------------------- doing */

  private async executeTurn(
    snapshot: DiscussionSnapshot,
    eligibility: Eligibility,
    decision: TurnDecision,
  ): Promise<boolean> {
    const speaker = snapshot.experts.find((e) => e.id === decision.speakerId);
    if (!speaker) return false;

    const first = await this.attemptTurn(snapshot, decision, speaker, false);
    if (first) return true;
    if (this.stopRequested) return false;
    // Degraded pass: deterministic text, one completed message per turn.started.
    return this.attemptTurn(snapshot, decision, speaker, true);
  }

  private async attemptTurn(
    snapshot: DiscussionSnapshot,
    decision: TurnDecision,
    speaker: ExpertPersona,
    degraded: boolean,
  ): Promise<boolean> {
    const messageId = prefixedId("m");
    const turnIndex = snapshot.turnCount + 1;

    this.append("turn.started", {
      turnIndex,
      speakerId: speaker.id,
      speakerName: speaker.name,
      intent: decision.intent,
      turnFocus: decision.turnFocus,
      messageId,
      ...(decision.targetMessageId ? { targetMessageId: decision.targetMessageId } : {}),
      ...(decision.references && decision.references.length > 0
        ? { references: decision.references }
        : {}),
    });

    let raw = "";
    let usedFallback = degraded;
    if (degraded) {
      raw = fallbackSpeechFor(speaker.name, speaker.stance, decision.turnFocus);
    } else {
      try {
        raw = await this.speak(snapshot, decision, speaker, messageId);
      } catch (error) {
        const reason = abortReasonFor(error);
        this.append("turn.aborted", {
          turnIndex,
          speakerId: speaker.id,
          messageId,
          reason,
          retryable: reason !== "interrupted",
        });
        return false;
      }
    }

    const check = validateSpeech(raw, {
      recent: snapshot.messages.slice(-3),
      isHost: speaker.role === "host",
    });
    const content = check.text.trim()
      ? check.text
      : fallbackSpeechFor(speaker.name, speaker.stance, decision.turnFocus);
    if (!check.text.trim()) usedFallback = true;

    const degradedFlag = usedFallback || !check.ok;
    const now = this.deps.clock();

    const write = this.deps.db.transaction(() => {
      const message = this.deps.repos.messages.insert({
        id: messageId,
        discussionId: this.discussionId,
        expertId: speaker.id,
        turnIndex,
        intent: decision.intent,
        content,
        charCount: [...content].length,
        degraded: degradedFlag,
        targetMessageId: decision.targetMessageId ?? null,
        references: decision.references ?? [],
        createdAt: now,
      });
      this.deps.events.append({
        discussionId: this.discussionId,
        type: "message.completed",
        payload: {
          message: toMessageDto(
            message,
            new Map(snapshot.experts.map((e) => [e.id, e as never])),
          ),
        },
      });
      this.deps.repos.discussions.setTurnCount(this.discussionId, turnIndex, now);
    });
    write();
    this.lastProgressAt = Date.now();
    return true;
  }

  private async speak(
    snapshot: DiscussionSnapshot,
    decision: TurnDecision,
    speaker: ExpertPersona,
    messageId: string,
  ): Promise<string> {
    const timeoutMs = this.deps.config.llm.timeouts.speech;
    const prompt = buildSpeechPrompt({ snapshot, decision, speaker });
    const signal = combineSignals([this.abort.signal, AbortSignal.timeout(timeoutMs)]);

    // "Thinking" starts when the model call starts: the seat shows 思考中 until the
    // first token, then flips to 发言中 on the first message.delta.
    // Transient frame (no seq, not persisted), and it never carries reasoning_content.
    this.deps.broadcaster.emitEphemeral(this.discussionId, "message.thinking", {
      discussionId: this.discussionId,
      messageId,
      speakerId: speaker.id,
      turnIndex: snapshot.turnCount + 1,
      intent: decision.intent,
    });

    let buffer = "";
    const stream = this.deps.llm.stream({
      prompt,
      signal,
      firstTokenTimeoutMs: Math.min(this.deps.config.llm.firstTokenTimeoutMs, timeoutMs),
      totalTimeoutMs: prompt.timeoutMs ?? timeoutMs,
      meta: {
        discussionId: this.discussionId,
        scenario: this.scenario(),
        turnIndex: snapshot.turnCount + 1,
        expertCount: snapshot.expertCount,
        roster: snapshot.experts.map((e) => ({ id: e.id, role: e.role, name: e.name })),
        topic: snapshot.topic,
        messageIds: snapshot.messages.map((m) => m.id),
        speakerId: speaker.id,
        intent: decision.intent,
        turnFocus: decision.turnFocus,
        previousContent: snapshot.messages.at(-1)?.content,
      },
    });

    for await (const delta of stream) {
      // No stop check here on purpose: during the `/end` grace window the current
      // utterance must be allowed to finish (contract: 3s grace). The abort signal
      // — fired by the grace timer — is what actually interrupts it.
      buffer += delta;
      // Deltas are never persisted: they are reconstructible from message.completed.
      this.deps.broadcaster.emitEphemeral(this.discussionId, "message.delta", {
        discussionId: this.discussionId,
        messageId,
        speakerId: speaker.id,
        turnIndex: snapshot.turnCount + 1,
        delta,
      });
    }
    return buffer;
  }

  private append(type: "turn.started" | "turn.aborted", payload: Record<string, unknown>): void {
    try {
      this.deps.events.append({ discussionId: this.discussionId, type, payload });
      this.lastProgressAt = Date.now();
    } catch (error) {
      this.deps.log.debug(
        { discussionId: this.discussionId, type, err: (error as Error).message },
        "runner event rejected",
      );
    }
  }
}

/** A close *signal* from the policy or the model: `action: "close"` or a `summary` turn. */
export function isClosingSignal(decision: TurnDecision): boolean {
  return decision.action === "close" || decision.intent === "summary";
}

/**
 * A terminal turn: only the normalized closing decision carries `action: "close"`.
 *
 * The loop trusts this flag alone, never `intent === "summary"` on its own — an
 * expert whose intent was sanitized into `summary` must not end the session. Every
 * closing signal is normalized to host + summary + action=close in
 * `normalizeClosingDecision` before it can reach the loop.
 */
export function isTerminalTurn(decision: TurnDecision): boolean {
  return decision.action === "close";
}

function intentForPolarity(expert: ExpertPersona): TurnDecision["intent"] {
  switch (expert.polarity) {
    case "strong_oppose":
    case "oppose":
      return "rebut";
    case "strong_support":
    case "support":
      return "support";
    default:
      return "extend";
  }
}

function abortReasonFor(error: unknown): string {
  if (error instanceof LlmError) {
    switch (error.kind) {
      case "timeout":
        return "llm_timeout";
      case "aborted":
        return "interrupted";
      case "invalid_output":
        return "invalid_output";
      case "empty_output":
        return "empty_output";
      default:
        return "llm_timeout";
    }
  }
  return "invalid_output";
}
