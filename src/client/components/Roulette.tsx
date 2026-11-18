import { useEffect, useMemo, useRef, useState } from 'react';
import { PsDialog } from './PsDialog';

export type RouletteSegment = {
  action: 'shock' | 'vibrate' | 'beep' | 'safe';
  intensity: number;
  durationMs: number;
};

export type RouletteSpinView = {
  spinId: string;
  targetName: string;
  segments: RouletteSegment[];
  resultIndex: number;
  /** Local timestamp when the wheel starts (server startAt mapped onto this clock). */
  startsAtLocal: number;
  spinMs: number;
  result?: { outcome: 'sent' | 'queued' | 'safe' | 'refused'; message: string | null };
};

export type RouletteVoteView = {
  voteId: string;
  targetDiscordUserId: string;
  targetName: string;
  starterName: string;
  actions: string[];
  endsAt: number;
  /** Viewer is the wearer → veto instead of yes/no. */
  isTarget: boolean;
  myVote?: boolean;
};

const COLORS: Record<RouletteSegment['action'], string> = {
  shock: '#e53935',
  vibrate: '#79c6db',
  beep: '#f4d600',
  safe: '#5b6168',
};

function label(s: RouletteSegment): string {
  if (s.action === 'safe') return 'SAFE';
  const sec = (s.durationMs / 1000).toFixed(1);
  if (s.action === 'beep') return `B ${sec}s`;
  return `${s.action === 'shock' ? 'S' : 'V'}${s.intensity} ${sec}s`;
}

export function describeSegment(s: RouletteSegment): string {
  if (s.action === 'safe') return 'Safe — nothing happens';
  const sec = (s.durationMs / 1000).toFixed(1);
  if (s.action === 'beep') return `Beep for ${sec}s`;
  return `${s.action === 'shock' ? 'Shock' : 'Vibrate'} ${s.intensity}% for ${sec}s`;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** Same payload → same animation and landing segment on every viewer's screen. */
export function RouletteWheel({
  segments,
  resultIndex,
  startsAtLocal,
  spinMs,
  onDone,
}: {
  segments: RouletteSegment[];
  resultIndex: number;
  startsAtLocal: number;
  spinMs: number;
  onDone?: () => void;
}) {
  const n = Math.max(1, segments.length);
  const slice = 360 / n;
  const finalAngle = 360 * 6 - (resultIndex + 0.5) * slice;
  const [angle, setAngle] = useState(0);
  const doneRef = useRef(false);
  const reduced =
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    doneRef.current = false;
    let raf = 0;
    const tick = () => {
      const t = (Date.now() - startsAtLocal) / spinMs;
      if (reduced && t >= 0) {
        setAngle(finalAngle);
      } else {
        setAngle(t <= 0 ? 0 : finalAngle * easeOutCubic(Math.min(1, t)));
      }
      if (t >= 1 || (reduced && t >= 0)) {
        if (!doneRef.current) {
          doneRef.current = true;
          onDone?.();
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [startsAtLocal, spinMs, finalAngle, reduced, onDone]);

  const r = 100;
  const paths = segments.map((seg, i) => {
    const a0 = ((i * slice - 90) * Math.PI) / 180;
    const a1 = (((i + 1) * slice - 90) * Math.PI) / 180;
    const large = slice > 180 ? 1 : 0;
    const d = `M0 0 L${r * Math.cos(a0)} ${r * Math.sin(a0)} A${r} ${r} 0 ${large} 1 ${r * Math.cos(a1)} ${r * Math.sin(a1)} Z`;
    const mid = (((i + 0.5) * slice - 90) * Math.PI) / 180;
    return { d, seg, tx: 62 * Math.cos(mid), ty: 62 * Math.sin(mid), rot: (i + 0.5) * slice };
  });

  return (
    <div className="roulette-wheel" role="img" aria-label="Roulette wheel">
      <svg viewBox="-110 -118 220 228" width="100%" height="100%">
        <polygon points="-9,-116 9,-116 0,-96" fill="#e8e8e8" />
        <g transform={`rotate(${angle})`}>
          {paths.map((p, i) => (
            <g key={i}>
              <path d={p.d} fill={COLORS[p.seg.action]} stroke="#121212" strokeWidth="1.5" />
              <text
                x={p.tx}
                y={p.ty}
                transform={`rotate(${p.rot} ${p.tx} ${p.ty})`}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={n > 10 ? 9 : 10.5}
                fontWeight={700}
                fill={p.seg.action === 'beep' ? '#1a1500' : p.seg.action === 'vibrate' ? '#003640' : '#fff'}
              >
                {label(p.seg)}
              </text>
            </g>
          ))}
          <circle r="14" fill="#121212" stroke="#e8e8e8" strokeWidth="2" />
        </g>
      </svg>
    </div>
  );
}

export function RouletteSpinOverlay({ spin, onClose }: { spin: RouletteSpinView; onClose: () => void }) {
  const [landed, setLanded] = useState(false);
  const result = spin.segments[spin.resultIndex];
  return (
    <PsDialog open title={`Roulette · ${spin.targetName}`} onClose={onClose}>
      <div className="ps-stack ps-stack--lg roulette-overlay">
        <RouletteWheel
          segments={spin.segments}
          resultIndex={spin.resultIndex}
          startsAtLocal={spin.startsAtLocal}
          spinMs={spin.spinMs}
          onDone={() => setLanded(true)}
        />
        <div className="roulette-overlay__result" aria-live="polite">
          {landed && result ? (
            <>
              <strong>{describeSegment(result)}</strong>
              {spin.result ? (
                <span className={spin.result.outcome === 'refused' ? 'text-negative' : 'text-grey-5'}>
                  {spin.result.outcome === 'sent'
                    ? ' · sent'
                    : spin.result.outcome === 'queued'
                      ? ' · in their queue'
                      : spin.result.outcome === 'refused'
                        ? ` · not sent: ${spin.result.message ?? 'refused'}`
                        : ''}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-grey-5">Spinning…</span>
          )}
        </div>
      </div>
    </PsDialog>
  );
}

export function RouletteStartDialog({
  open,
  targetName,
  busy,
  onClose,
  onStart,
}: {
  open: boolean;
  targetName: string;
  busy?: boolean;
  onClose: () => void;
  onStart: (opts: { actions: RouletteSegment['action'][]; mode: 'solo' | 'vote' }) => void;
}) {
  const [actions, setActions] = useState<Set<RouletteSegment['action']>>(
    () => new Set(['shock', 'vibrate', 'beep', 'safe']),
  );
  const [mode, setMode] = useState<'solo' | 'vote'>('solo');
  const toggle = (a: RouletteSegment['action']) =>
    setActions((prev) => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a);
      else next.add(a);
      return next;
    });
  return (
    <PsDialog open={open} title={`Spin the wheel for ${targetName}`} onClose={onClose}>
      <div className="ps-stack ps-stack--lg">
        <div>
          <div className="ps-section-title">On the wheel</div>
          <div className="log-privacy__toggles log-privacy__toggles--row">
            {(['shock', 'vibrate', 'beep', 'safe'] as const).map((a) => (
              <label key={a} className={`log-privacy__toggle${actions.has(a) ? ' is-on' : ''}`}>
                <input type="checkbox" className="ps-check" checked={actions.has(a)} onChange={() => toggle(a)} />
                <span className="log-privacy__toggle-copy">
                  <span className="log-privacy__toggle-title">{a[0]!.toUpperCase() + a.slice(1)}</span>
                </span>
              </label>
            ))}
          </div>
          <p className="log-privacy__note">Values are random but always within their limits.</p>
        </div>
        <div className="safety-periods" role="radiogroup" aria-label="How to spin">
          {(
            [
              ['solo', 'Spin now', 'Only you see the wheel.'],
              ['vote', 'Room vote', 'Everyone here votes for 20s. Needs 2+ yes and more yes than no; they can veto.'],
            ] as const
          ).map(([id, title, hint]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={mode === id}
              className={`log-privacy__scope${mode === id ? ' is-active' : ''}`}
              onClick={() => setMode(id)}
            >
              <span className="log-privacy__scope-title">{title}</span>
              <span className="log-privacy__scope-hint">{hint}</span>
            </button>
          ))}
        </div>
        <div className="row justify-end">
          <button
            type="button"
            className="safety-btn safety-btn--accept"
            disabled={busy || actions.size === 0}
            onClick={() => onStart({ actions: [...actions], mode })}
          >
            <i className="q-icon mdi mdi-ship-wheel" aria-hidden /> {mode === 'vote' ? 'Start vote' : 'Spin'}
          </button>
        </div>
      </div>
    </PsDialog>
  );
}

/** Vote prompts float at the bottom; the wearer gets a separate Veto button. */
export function RouletteVotePrompts({
  votes,
  onVote,
  onVeto,
}: {
  votes: RouletteVoteView[];
  onVote: (voteId: string, yes: boolean) => void;
  onVeto: (voteId: string) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const live = useMemo(() => votes.filter((v) => v.endsAt > now), [votes, now]);
  if (!live.length) return null;
  return (
    <div className="roulette-votes" role="region" aria-label="Roulette votes">
      {live.map((v) => (
        <div key={v.voteId} className={`safety-approval${v.isTarget ? ' roulette-vote--target' : ''}`}>
          <div className="safety-approval__head">
            <i className="q-icon mdi mdi-ship-wheel" aria-hidden />
            <span>
              {v.isTarget ? (
                <>
                  <strong>{v.starterName}</strong> started a vote to spin the wheel on <strong>you</strong>
                </>
              ) : (
                <>
                  <strong>{v.starterName}</strong> wants to spin the wheel on <strong>{v.targetName}</strong>
                </>
              )}
            </span>
            <span className="safety-approval__time">{Math.ceil((v.endsAt - now) / 1000)}s</span>
          </div>
          <div className="safety-approval__detail">On the wheel: {v.actions.join(', ')}</div>
          <div className="safety-approval__actions">
            {v.isTarget ? (
              <button type="button" className="safety-btn safety-btn--danger" onClick={() => onVeto(v.voteId)}>
                Veto
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={`safety-btn${v.myVote === false ? ' safety-btn--danger' : ''}`}
                  onClick={() => onVote(v.voteId, false)}
                >
                  No
                </button>
                <button
                  type="button"
                  className={`safety-btn${v.myVote === true ? ' safety-btn--accept' : ''}`}
                  onClick={() => onVote(v.voteId, true)}
                >
                  Yes
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
