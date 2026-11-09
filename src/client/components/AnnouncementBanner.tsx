import { useEffect, useMemo, useState } from 'react';
import { apiBase } from '../api';
import { openExternal } from '../discord';

export type LiveAnnouncement = {
  text: string;
  link: string | null;
  expires: string | null;
};

const DISMISS_KEY = 'pishock.announcements.dismissed';

function dismissedSet(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return new Set();
  }
}

function rememberDismiss(key: string) {
  const next = dismissedSet();
  next.add(key);
  sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
}

function announcementKey(a: LiveAnnouncement): string {
  return `${a.text}::${a.link ?? ''}`;
}

/** Matches pishock.com control-page live announcement card. */
export function AnnouncementBanner() {
  const [items, setItems] = useState<LiveAnnouncement[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => dismissedSet());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiBase()}/announcements`, {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) return;
        const data = (await res.json()) as { announcements?: LiveAnnouncement[] };
        if (!cancelled) setItems(data.announcements ?? []);
      } catch {
        // banner is best-effort
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(
    () => items.filter((a) => a.text && !dismissed.has(announcementKey(a))),
    [items, dismissed],
  );

  if (visible.length === 0) return null;

  return (
    <div className="official-announcements q-mt-md">
      <div className="column q-gutter-sm items-center" style={{ width: '100%', maxWidth: 560 }}>
        {visible.map((a) => {
          const key = announcementKey(a);
          return (
            <div
              key={key}
              className="q-card q-card--dark q-dark q-card--bordered border-color-secondary relative-position full-width"
              style={{ background: '#1a1a1a', textAlign: 'center' }}
            >
              <button
                type="button"
                aria-label="Dismiss announcement"
                className="q-btn q-btn-item non-selectable no-outline q-btn--flat q-btn--round text-grey-5 q-btn--dense"
                style={{ position: 'absolute', top: 2, right: 2, zIndex: 1 }}
                onClick={() => {
                  rememberDismiss(key);
                  setDismissed(dismissedSet());
                }}
              >
                <span className="q-btn__wrapper col row q-anchor--skip">
                  <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                    <i className="q-icon mdi mdi-close" aria-hidden />
                  </span>
                </span>
              </button>
              <div className="q-card__section q-card__section--vert q-pa-md text-center text-white">
                {a.text.split('\n').map((line, i) => (
                  <div
                    key={i}
                    className={i === 0 ? 'text-body1' : 'text-body2 q-mt-xs'}
                    style={{ textAlign: 'center' }}
                  >
                    {line}
                  </div>
                ))}
                {a.link ? (
                  <div className="row justify-center q-mt-sm">
                    <button
                      type="button"
                      className="q-btn q-btn-item non-selectable no-outline q-btn--flat q-btn--dense text-secondary"
                      style={{ fontSize: 12, textDecoration: 'underline' }}
                      onClick={() => void openExternal(a.link!)}
                    >
                      <span className="q-btn__wrapper col row q-anchor--skip">
                        <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                          <span className="block">Click here to view</span>
                        </span>
                      </span>
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
