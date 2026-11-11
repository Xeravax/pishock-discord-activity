import { useState } from 'react';

type Props = {
  value: string;
  /** Spoken name, e.g. "API key" or "share code". */
  label: string;
  className?: string;
};

/** Secret shown as bullets until the value itself is clicked. */
export function SecretValue({ value, label, className }: Props) {
  const [shown, setShown] = useState(false);
  const mask = '•'.repeat(Math.min(Math.max(value.length, 8), 28));
  return (
    <button
      type="button"
      className={`secret-value${shown ? ' secret-value--shown' : ''}${className ? ` ${className}` : ''}`}
      onClick={() => setShown((open) => !open)}
      aria-pressed={shown}
      aria-label={shown ? `Hide ${label}` : `Show ${label}`}
      title={shown ? `Click to hide ${label}` : `Click to show ${label}`}
    >
      {shown ? value : mask}
    </button>
  );
}
