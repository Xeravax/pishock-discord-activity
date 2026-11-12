import { useId, useState, type CSSProperties } from 'react';

const describedValueStyle: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};

type Props = {
  value: string;
  /** Spoken name, e.g. "API key" or "share code". */
  label: string;
  className?: string;
};

/** Secret shown as bullets until the value itself is clicked. */
export function SecretValue({ value, label, className }: Props) {
  const [shown, setShown] = useState(false);
  const descriptionId = useId();
  const mask = '•'.repeat(Math.min(Math.max(value.length, 8), 28));
  return (
    <span className="secret-value-wrap">
      <button
        type="button"
        className={`secret-value${shown ? ' secret-value--shown' : ''}${className ? ` ${className}` : ''}`}
        onClick={() => setShown((open) => !open)}
        aria-pressed={shown}
        aria-describedby={descriptionId}
        aria-label={shown ? `Hide ${label}` : `Show ${label}`}
        title={shown ? `Click to hide ${label}` : `Click to show ${label}`}
      >
        <span aria-hidden="true">{shown ? value : mask}</span>
      </button>
      <span id={descriptionId} style={describedValueStyle}>
        {shown ? value : ''}
      </span>
    </span>
  );
}
