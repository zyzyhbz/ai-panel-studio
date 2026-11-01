/**
 * The single large gradient in the app: a warm top light plus a bottom
 * vignette. Everything else is 1px lines and 3% panels.
 */
export function StageBackdrop() {
  return <div aria-hidden className="stage-backdrop pointer-events-none fixed inset-0 z-0" />;
}
