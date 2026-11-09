import type { ReactNode } from 'react';

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
};

/** Quasar dialog shell matching pishock.com dark cards */
export function PsDialog({ open, title, onClose, children, wide }: Props) {
  if (!open) return null;

  return (
    <div className="ps-dialog-root" style={{ zIndex: 7000 }}>
      <div className="ps-dialog-backdrop" onClick={onClose} />
      <div
        className="ps-dialog-inner"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div
          className="q-card q-card--dark q-dark bg-dark"
          style={{
            width: wide ? 'min(720px, 94vw)' : 'min(480px, 94vw)',
            maxHeight: '88vh',
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid rgba(121, 198, 219, 0.35)',
            pointerEvents: 'auto',
          }}
        >
          <div className="q-card__section q-card__section--vert row items-center justify-between no-wrap">
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
          <div
            className="q-card__section q-card__section--vert"
            style={{ overflow: 'auto', paddingTop: 0 }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
