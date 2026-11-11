const STYLES = {
  succeeded: { symbol: "✓", label: "Succeeded", color: "var(--good)" },
  failed: { symbol: "✕", label: "Failed", color: "var(--critical)" },
  running: { symbol: "◐", label: "Running", color: "var(--active)" },
  queued: { symbol: "○", label: "Queued", color: "var(--text-3)" },
  stopped: { symbol: "■", label: "Stopped by filter", color: "var(--text-3)" },
  retrying: { symbol: "↻", label: "Failed, will retry", color: "var(--warning)" },
  waiting: { symbol: "◷", label: "Waiting", color: "var(--active)" },
} as const;

export type StatusName = keyof typeof STYLES;

export default function Status({ name, label }: { name: StatusName; label?: string }) {
  const style = STYLES[name];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm whitespace-nowrap">
      <span style={{ color: style.color }} aria-hidden>
        {style.symbol}
      </span>
      {label ?? style.label}
    </span>
  );
}
