import type { ReactNode } from 'react';

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** Use nearly all of the Discord activity viewport */
  fill?: boolean;
};

/** Quasar dialog shell matching pishock.com dark cards */
export function PsDialog({ open, title, onClose, children, wide, fill }: Props) {
  if (!open) return null;

  const sizeClass = fill ? ' is-fill' : wide ? ' is-wide' : '';

  return (
    <div className={`ps-dialog-root${fill ? ' is-fill' : ''}`}>
      <div
        className="ps-dialog-backdrop"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      />
      <div
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
