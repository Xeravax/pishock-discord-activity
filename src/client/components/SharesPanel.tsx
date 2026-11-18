import { useState } from 'react';
import { SecretValue } from './SecretValue';

type SharedRow = {
  ShareId?: number;
  shareId?: number;
  ShareCode?: string;
  shareCode?: string;
  Code?: string;
  code?: string;
  Name?: string;
  name?: string;
  ShockerName?: string;
  shockerName?: string;
  Username?: string;
  username?: string;
  Paused?: boolean;
  paused?: boolean;
  SharePaused?: boolean;
  sharePaused?: boolean;
};

type Props = {
  shared: SharedRow[];
  shockers: { id: number; name: string }[];
  busy: boolean;
  onCreateShare: (shockerId: number) => void;
  onClaimShare: (code: string) => void | Promise<void>;
};

export function SharesPanel({
  shared,
  shockers,
  busy,
  onCreateShare,
  onClaimShare,
}: Props) {
  const [shockerId, setShockerId] = useState(shockers[0]?.id ?? 0);
  const [claimCode, setClaimCode] = useState('');

  return (
    <div className="ps-stack ps-stack--lg">
      <div className="text-grey-5 text-body2">
        Redeem a share code from someone else, or create a code for one of your shockers.
      </div>

      <div className="ps-stack">
        <div className="ps-section-title">Redeem share code</div>
        <div className="ps-inline">
          <input
            value={claimCode}
            onChange={(e) => setClaimCode(e.target.value)}
            placeholder="Enter share code"
            className="ps-field"
            style={{ minWidth: 180, flex: 1 }}
            disabled={busy}
          />
          <button
            type="button"
            className="q-btn q-btn-item non-selectable no-outline bg-secondary text-dark q-btn--standard q-btn--rectangle q-btn--actionable"
            disabled={busy || !claimCode.trim()}
            onClick={() => {
              const code = claimCode.trim();
              if (!code) return;
              void Promise.resolve(onClaimShare(code)).then(() => setClaimCode(''));
            }}
          >
            <span className="q-btn__wrapper col row q-anchor--skip">
              <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                <span className="block">Add share code</span>
              </span>
            </span>
          </button>
        </div>
      </div>

      <div className="ps-stack">
        <div className="ps-section-title">Create for your shocker</div>
        <div className="ps-inline">
          <select
            value={shockerId}
            onChange={(e) => setShockerId(Number(e.target.value))}
            className="ps-field"
            style={{ minWidth: 160, flex: 1 }}
          >
            {shockers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="q-btn q-btn-item non-selectable no-outline text-secondary bg-dark q-btn--outline q-btn--rectangle q-btn--actionable"
            disabled={busy || !shockerId}
            onClick={() => onCreateShare(shockerId)}
          >
            <span className="q-btn__wrapper col row q-anchor--skip">
              <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                <span className="block">Create share code</span>
              </span>
            </span>
          </button>
        </div>
      </div>

      <div className="ps-stack">
        <div className="ps-section-title">Shared with you</div>
        <div className="q-list q-list--dark ps-row-list">
          {shared.length === 0 ? (
            <div className="ps-empty">No redeemed share codes yet.</div>
          ) : null}
          {shared.map((row, idx) => {
            const id = row.ShareId ?? row.shareId ?? idx;
            const code =
              row.ShareCode ?? row.shareCode ?? row.Code ?? row.code ?? null;
            const title =
              row.ShockerName ??
              row.shockerName ??
              row.Name ??
              row.name ??
              `Share ${id}`;
            const owner = row.Username ?? row.username;
            const paused = Boolean(
              row.Paused ?? row.paused ?? row.SharePaused ?? row.sharePaused,
            );
            return (
              <div key={String(id)} className="q-item q-item-type column ps-row">
                <div className="q-item__label text-secondary">{title}</div>
                <div className="q-item__label q-item__label--caption text-grey-5">
                  {owner ? `${owner} · ` : ''}
                  {code ? (
                    <>
                      Code <SecretValue value={code} label="share code" />
                      {' · '}
                    </>
                  ) : null}
                  {paused ? 'Paused' : 'Active'}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
