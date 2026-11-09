import { useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'pishock.safetyNotice.confirmed.v1';
const HOVER_FILL_MS = 2200;

const SAFETY_POINTS = [
  'Only use with explicit, informed consent from everyone involved.',
  'Start at the lowest intensity and increase slowly.',
  'Keep emergency STOP reachable and agree on a safe word / release plan.',
  'This controls real electronic shock devices — misuse can cause harm.',
  'Actions in this activity are logged. You are responsible for lawful, safe use.',
];

type Props = {
  /** Force the full warning panel until the user confirms (first-time). */
  forceOpen?: boolean;
  onConfirmed?: () => void;
};

function hasConfirmed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function markConfirmed() {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // ignore
  }
}

/**
 * Persistent header safety strip.
 * Hover-fill opens the full notice; first-time users are forced through it before control.
 */
export function SafetyNoticeBar({ forceOpen = false, onConfirmed }: Props) {
  const [open, setOpen] = useState(() => forceOpen || !hasConfirmed());
  const [blocking, setBlocking] = useState(() => forceOpen || !hasConfirmed());
  const [progress, setProgress] = useState(0);
  const [hovering, setHovering] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (forceOpen || !hasConfirmed()) {
      setOpen(true);
      setBlocking(true);
    }
  }, [forceOpen]);

  useEffect(() => {
    if (!hovering || open) {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      startRef.current = null;
      if (!hovering && !open) setProgress(0);
      return;
    }

    const tick = (now: number) => {
      if (startRef.current == null) startRef.current = now;
      const elapsed = now - startRef.current;
      const next = Math.min(1, elapsed / HOVER_FILL_MS);
      setProgress(next);
      if (next >= 1) {
        setOpen(true);
        setProgress(0);
        startRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [hovering, open]);

  const confirm = () => {
    markConfirmed();
    setBlocking(false);
    setOpen(false);
    setProgress(0);
    onConfirmed?.();
  };

  return (
    <>
      <div
        className="official-safety-banner"
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        onFocus={() => setHovering(true)}
        onBlur={() => setHovering(false)}
        role="button"
        tabIndex={0}
        aria-label="Safety notice — hover to open details"
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <div className="row items-center no-wrap justify-center q-gutter-xs" style={{ position: 'relative', zIndex: 1 }}>
          <i className="q-icon mdi mdi-shield-alert-outline" aria-hidden style={{ fontSize: 14 }} />
          <div className="text-caption ellipsis official-safety-banner__text">
            <strong>Safety notice</strong>
            <span className="official-safety-banner__sep">·</span>
            hover to review warnings
          </div>
        </div>
        <div
          className="official-safety-banner__fill"
          style={{ transform: `scaleX(${progress})` }}
          aria-hidden
        />
      </div>

      {open ? (
        <div
          className={`official-safety-panel ${blocking ? 'official-safety-panel--blocking' : ''}`}
          role="dialog"
          aria-modal={blocking}
          aria-labelledby="safety-notice-title"
        >
          <div className="official-safety-panel__card">
            <div className="row items-center q-gutter-sm q-mb-sm">
              <i className="q-icon mdi mdi-alert text-negative" aria-hidden />
              <h2 id="safety-notice-title" className="text-negative text-h6" style={{ margin: 0 }}>
                Safety notice
              </h2>
            </div>
            <p className="text-body2" style={{ color: '#ffc9c9' }}>
              This Discord activity can control real electronic shock devices. Read these warnings
              carefully before you continue.
            </p>
            <ul className="official-safety-panel__list">
              {SAFETY_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
            <div className="row justify-end q-gutter-sm q-mt-md">
              {!blocking ? (
                <button
                  type="button"
                  className="q-btn q-btn--outline text-secondary q-btn--rectangle"
                  onClick={() => setOpen(false)}
                >
                  Close
                </button>
              ) : null}
              <button
                type="button"
                className="q-btn q-btn--standard bg-secondary text-dark q-btn--rectangle"
                onClick={confirm}
              >
                {blocking ? 'I understand — continue' : 'Got it'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function safetyNoticeConfirmed(): boolean {
  return hasConfirmed();
}
