/**
 * Transport contract owned by `packages/agent` (G1 decision §1.11).
 *
 * The server implements the real DeepSeek transport (`deepseek.ts`) and keeps its
 * runtime mock (`mock.ts`) for QA hooks; both implement this interface. Re-exporting
 * instead of redefining keeps one single source of truth.
 */
export * from "@ai-panel/agent";
