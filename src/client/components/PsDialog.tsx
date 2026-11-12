import { useEffect, useRef, type ReactNode } from 'react';

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** Use nearly all of the Discord activity viewport */
  fill?: boolean;
};

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((el) => {
    if (el.getAttribute('aria-hidden') === 'true') return false;
    return el.getClientRects().length > 0;
  });
}

/** Quasar dialog shell matching pishock.com dark cards */
export function PsDialog({ open, title, onClose, children, wide, fill }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    previouslyFocused.current = active instanceof HTMLElement ? active : null;
    const node = dialogRef.current;
    const initial = node ? focusableIn(node) : [];
    (initial[0] ?? node)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      const items = focusableIn(node);
      if (items.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const current = document.activeElement;
      const outside = !(current instanceof Node) || !node.contains(current);
      if (event.shiftKey) {
        if (current === first || outside) {
          event.preventDefault();
          last.focus();
        }
        return;
      }
      if (current === last || outside) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      const previous = previouslyFocused.current;
      previouslyFocused.current = null;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  const sizeClass = fill ? ' is-fill' : wide ? ' is-wide' : '';

  return (
    <div className={`ps-dialog-root${fill ? ' is-fill' : ''}`}>
      <div className="ps-dialog-backdrop" onClick={onClose} />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`ps-dialog-inner${sizeClass}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={`ps-dialog-card q-card q-card--dark q-dark bg-dark${sizeClass}`}>
          <div className="ps-dialog-header q-card__section q-card__section--vert row items-center justify-between no-wrap">
            <div className="text-h6 text-secondary" style={{ fontFamily: 'geo, Oxanium, sans-serif' }}>
              {title}
            </div>
            <button
              type="button"
              className="q-btn q-btn-item non-selectable no-outline q-btn--flat q-btn--round text-secondary q-btn--actionable q-btn--dense"
              onClick={onClose}
              aria-label="Close"
            >
              <span className="q-btn__wrapper col row q-anchor--skip">
                <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                  <i className="q-icon mdi mdi-close" aria-hidden />
                </span>
              </span>
            </button>
          </div>
          <div className="ps-dialog-body q-card__section q-card__section--vert">{children}</div>
        </div>
      </div>
    </div>
  );
}
