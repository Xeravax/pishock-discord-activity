import { useState } from 'react';
import type { AppNotice } from '../realtime';

const KEY = 'pishock.appNotice.dismissed';

function readDismissed(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** App-wide notice from the admin panel. Dismissing hides this version of it only. */
export function AppNoticeBanner({ notice }: { notice: AppNotice }) {
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed === notice.updatedAt) return null;
  return (
    <div className={`app-notice app-notice--${notice.level}`} role="status">
      <i
        className={`q-icon mdi ${notice.level === 'warning' ? 'mdi-alert-outline' : 'mdi-bullhorn-outline'}`}
        aria-hidden
      />
      <span className="app-notice__text">{notice.text}</span>
      <button
        type="button"
        className="app-notice__close"
        aria-label="Hide notice"
        onClick={() => {
          try {
            localStorage.setItem(KEY, notice.updatedAt);
          } catch {
            // ignore
          }
          setDismissed(notice.updatedAt);
        }}
      >
        <i className="q-icon mdi mdi-close" aria-hidden />
      </button>
    </div>
  );
}
