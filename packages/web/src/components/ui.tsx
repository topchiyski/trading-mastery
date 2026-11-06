import { useEffect, useId, useState, type ReactNode } from 'react';
import { errorMessage } from '../api/client';
import type { Tag } from '../api/types';

/** Label + control + inline error. The control gets the generated id via render prop. */
export function Field({
  label,
  error,
  hint,
  wide,
  children,
}: {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  wide?: boolean;
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby'?: string;
  }) => ReactNode;
}) {
  const id = useId();
  const errId = `${id}-err`;
  return (
    <div className={`field${wide ? ' wide' : ''}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-invalid': !!error, ...(error ? { 'aria-describedby': errId } : {}) })}
      {error ? (
        <span id={errId} className="field-error">
          {error}
        </span>
      ) : hint ? (
        <span className="hint">{hint}</span>
      ) : null}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <div className="error-box" role="alert">
      {errorMessage(error)}
    </div>
  );
}

export function Stat({
  label,
  value,
  className,
  testId,
  title,
}: {
  label: string;
  value: ReactNode;
  className?: string;
  testId?: string;
  title?: string;
}) {
  return (
    <div className="stat" data-testid={testId} title={title}>
      <div className="label">{label}</div>
      <div className={`value ${className ?? ''}`}>{value}</div>
    </div>
  );
}

/** Two-click delete: no browser confirm() dialogs. */
export function ConfirmButton({
  onConfirm,
  label = 'Delete',
  confirmLabel = 'Confirm',
  disabled,
  ariaLabel,
}: {
  onConfirm: () => void;
  label?: string;
  confirmLabel?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      type="button"
      className="small danger"
      disabled={disabled}
      aria-label={armed && ariaLabel ? `Confirm: ${ariaLabel}` : ariaLabel}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  );
}

export function TagChip({ tag, onRemove }: { tag: Tag; onRemove?: () => void }) {
  return (
    <li className="chip">
      <span className="dot" style={{ background: tag.color }} aria-hidden />
      {tag.name}
      {onRemove ? (
        <button type="button" aria-label={`Remove tag ${tag.name}`} onClick={onRemove}>
          ×
        </button>
      ) : (
        <span style={{ width: 6 }} />
      )}
    </li>
  );
}

export function Loading() {
  return <div className="empty">Loading…</div>;
}
