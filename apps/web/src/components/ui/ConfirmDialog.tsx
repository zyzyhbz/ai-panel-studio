import { useEffect, useRef, type ReactNode } from "react";

/**
 * Minimal confirm dialog. Radix Dialog is used elsewhere (drawer); this one is
 * intentionally tiny and dependency-free so a blocking native confirm never
 * sneaks into the flow (it would break E2E and screen readers).
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确定",
  cancelLabel = "取消",
  tone = "default",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    const timer = window.setTimeout(() => confirmRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
    };
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <button
        type="button"
        aria-label="关闭"
        onClick={onCancel}
        className="absolute inset-0 bg-stage-1000/70 backdrop-blur-sm"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="confirm-dialog"
        className="relative w-full max-w-sm rounded-xl border border-line-2 bg-stage-850 p-5 shadow-2xl"
      >
        <h2 className="text-[15px] font-semibold text-ink-1">{title}</h2>
        {description !== undefined && (
          <div className="mt-2 text-[12.5px] leading-6 text-ink-3">{description}</div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 rounded-md border border-line-1 px-3 text-[12px] text-ink-2 transition-colors hover:bg-stage-800"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            data-testid="confirm-dialog-accept"
            className={
              tone === "danger"
                ? "h-9 rounded-md border border-danger/50 bg-danger/15 px-3 text-[12px] font-medium text-danger transition-colors hover:bg-danger/25"
                : "h-9 rounded-md bg-live px-3 text-[12px] font-semibold text-stage-1000 transition-colors hover:brightness-110"
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
