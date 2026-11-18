import { useEffect, useRef, useState } from 'react';
import type { ApprovalRequest } from '../safety';

// ---------------------------------------------------------------------------
// In-app beep (WebAudio). Never touches the shocker.

let audioCtx: AudioContext | null = null;

/** Short in-app tone. `urgent` = higher, double beep. Silently does nothing if audio is blocked. */
export function playAppBeep(urgent = false): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioCtx ??= new Ctor();
    const ctx = audioCtx;
    if (ctx.state === 'suspended') void ctx.resume();
    const tones = urgent ? [0, 0.22] : [0];
    for (const offset of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = urgent ? 1046 : 784;
      const t = ctx.currentTime + offset;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    }
  } catch {
    // Audio unavailable (autoplay policy, old client) — the visual prompt still shows.
  }
}

function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

function senderName(r: ApprovalRequest): string {
  return r.executorGlobalName || r.executorUsername || 'Someone';
}

function verb(operation: string): string {
  if (operation === 'vibrate' || operation === 'warning') return 'vibrate';
  if (operation === 'beep') return 'beep';
  if (operation === 'hold') return 'hold-shock';
  return 'shock';
}

// ---------------------------------------------------------------------------
// Approve-each

/** Persistent strip while approve-each is on. The Disable button only exists in that state. */
export function ApproveEachStrip({
  busy,
  onDisable,
}: {
  busy?: boolean;
  onDisable: () => void;
}) {
  return (
    <div className="safety-strip" role="status">
      <i className="q-icon mdi mdi-hand-back-left-outline" aria-hidden />
      <span className="safety-strip__text">
        <strong>Approve each command is ON</strong> — nothing reaches your shockers until you accept
        it.
      </span>
      <button type="button" className="safety-btn" disabled={busy} onClick={onDisable}>
        Disable
      </button>
    </div>
  );
}

export function ApprovalPrompts({
  requests,
  busyId,
  onAnswer,
}: {
  requests: ApprovalRequest[];
  busyId?: string | null;
  onAnswer: (approvalId: string, accept: boolean) => void;
}) {
  const now = useNow();
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const r of requests) {
      if (!seen.current.has(r.approvalId)) {
        seen.current.add(r.approvalId);
        playAppBeep(false);
      }
    }
  }, [requests]);

  const live = requests.filter((r) => r.expiresAt > now);
  if (!live.length) return null;

  return (
    <div className="safety-approvals" role="region" aria-label="Commands waiting for your approval">
      {live.map((r) => {
        const total = Math.max(1, r.expiresAt - r.at);
        const left = Math.max(0, r.expiresAt - now);
        const first = r.items[0];
        const more = r.items.length - 1;
        return (
          <div key={r.approvalId} className="safety-approval" role="alertdialog" aria-live="assertive">
            <div className="safety-approval__head">
              <i className="q-icon mdi mdi-account-alert-outline" aria-hidden />
              <span>
                <strong>{senderName(r)}</strong> wants to {verb(r.operation)} you
              </span>
              <span className="safety-approval__time">{Math.ceil(left / 1000)}s</span>
            </div>
            {first ? (
              <div className="safety-approval__detail">
                {r.operation === 'beep' ? '' : `${first.intensity}% · `}
                {(first.durationMs / 1000).toFixed(1)}s
                {first.shockerName ? ` on ${first.shockerName}` : ''}
                {more > 0 ? ` (+${more} more shocker${more === 1 ? '' : 's'})` : ''}
              </div>
            ) : null}
            <div className="safety-approval__bar" aria-hidden>
              <span style={{ width: `${(left / total) * 100}%` }} />
            </div>
            <div className="safety-approval__actions">
              <button
                type="button"
                className="safety-btn safety-btn--danger"
                disabled={busyId === r.approvalId}
                onClick={() => onAnswer(r.approvalId, false)}
              >
                Deny
              </button>
              <button
                type="button"
                className="safety-btn safety-btn--accept"
                disabled={busyId === r.approvalId}
                onClick={() => onAnswer(r.approvalId, true)}
              >
                Accept
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Check-ins

/** "Still OK?" modal. Beeps in the app every few seconds, faster near the deadline. */
export function CheckInPrompt({
  deadline,
  busy,
  onOk,
}: {
  deadline: number;
  busy?: boolean;
  onOk: () => void;
}) {
  const now = useNow();
  const left = Math.max(0, deadline - now);
  const urgent = left <= 15_000;

  useEffect(() => {
    playAppBeep(true);
    let id = 0;
    const tick = () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      playAppBeep(remaining <= 15_000);
      id = window.setTimeout(tick, remaining <= 15_000 ? 2_000 : 5_000);
    };
    id = window.setTimeout(tick, 5_000);
    return () => window.clearTimeout(id);
  }, [deadline]);

  return (
    <div className="ps-dialog-root safety-checkin-root" role="alertdialog" aria-modal="true" aria-labelledby="safety-checkin-title">
      <div className="ps-dialog-backdrop" />
      <div className={`safety-checkin${urgent ? ' is-urgent' : ''}`}>
        <i className="q-icon mdi mdi-account-heart-outline safety-checkin__icon" aria-hidden />
        <h2 id="safety-checkin-title">Still OK?</h2>
        <p>
          This is your check-in. If you don’t answer in <strong>{Math.ceil(left / 1000)}s</strong>, all
          your shared shockers will be <strong>paused</strong> and your queue cleared.
        </p>
        <button type="button" className="safety-btn safety-btn--accept safety-btn--lg" disabled={busy} onClick={onOk} autoFocus>
          I’m OK
        </button>
      </div>
    </div>
  );
}

export function CheckInMissedBanner({
  busy,
  onResume,
  onDismiss,
}: {
  busy?: boolean;
  onResume: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="safety-strip safety-strip--warn" role="alert">
      <i className="q-icon mdi mdi-pause-octagon-outline" aria-hidden />
      <span className="safety-strip__text">
        <strong>You missed a check-in</strong> — your shared shockers are paused.
      </span>
      <button type="button" className="safety-btn" disabled={busy} onClick={onResume}>
        Resume
      </button>
      <button type="button" className="safety-btn safety-btn--ghost" aria-label="Dismiss" onClick={onDismiss}>
        <i className="q-icon mdi mdi-close" aria-hidden />
      </button>
    </div>
  );
}
