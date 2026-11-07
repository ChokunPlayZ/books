export default function LoadingStatus({
  label,
  detail,
  completed,
  total,
  className = "",
}: {
  label: string;
  detail?: string;
  completed?: number;
  total?: number;
  className?: string;
}) {
  return (
    <div className={"loading-status " + className}>
      <div className="loading-status-message" role="status">
        <span className="loading-spinner" aria-hidden="true" />
        <div>
          <strong>{label}</strong>
          {detail && <p>{detail}</p>}
        </div>
      </div>
      <progress
        className="loading-progress"
        aria-label={label}
        value={total ? (completed ?? 0) : undefined}
        max={total || undefined}
      />
    </div>
  );
}
