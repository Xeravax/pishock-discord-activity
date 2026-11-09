import { useState } from 'react';

type LinkRow = {
  LinkId?: number;
  linkId?: number;
  Name?: string;
  name?: string;
  Code?: string;
  code?: string;
  Paused?: boolean;
  paused?: boolean;
  ShockerId?: number;
  shockerId?: number;
};

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
  links: LinkRow[];
  shared: SharedRow[];
  shockers: { id: number; name: string }[];
  busy: boolean;
  onCreate: (payload: Record<string, unknown>) => void;
  onPause: (linkId: number, pauseState: boolean) => void;
  onDelete: (linkId: number) => void;
  onCreateShare: (shockerId: number) => void;
  onClaimShare: (code: string) => void | Promise<void>;
};

export function SharesPanel({
  links,
  shared,
  shockers,
  busy,
  onCreate,
  onPause,
  onDelete,
  onCreateShare,
  onClaimShare,
}: Props) {
  const [name, setName] = useState('Activity link');
  const [shockerId, setShockerId] = useState(shockers[0]?.id ?? 0);
  const [claimCode, setClaimCode] = useState('');

  return (
    <div className="column q-gutter-md">
      <div className="text-grey-5 text-body2">
        Redeem a share code from someone else, create codes for your shockers, or manage website
        links.
      </div>

      <div className="column q-gutter-sm">
        <div className="text-secondary text-subtitle2">Redeem share code</div>
        <div className="row q-gutter-sm items-center" style={{ flexWrap: 'wrap' }}>
          <input
            value={claimCode}
            onChange={(e) => setClaimCode(e.target.value)}
            placeholder="Enter share code"
            className="bg-dark text-grey-3"
            style={{ ...fieldStyle, minWidth: 180, flex: 1 }}
            disabled={busy}
          />
          <button
            type="button"
            className="q-btn q-btn-item non-selectable no-outline bg-secondary text-dark q-btn--standard q-btn--rectangle q-btn--actionable q-btn--dense"
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

      <div className="column q-gutter-sm">
        <div className="text-secondary text-subtitle2">Create for your shocker</div>
        <div className="row q-gutter-sm items-center" style={{ flexWrap: 'wrap' }}>
          <select
            value={shockerId}
            onChange={(e) => setShockerId(Number(e.target.value))}
            className="bg-dark text-grey-3"
            style={fieldStyle}
          >
            {shockers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Link name"
            className="bg-dark text-grey-3"
            style={{ ...fieldStyle, minWidth: 140 }}
          />
          <button
            type="button"
            className="q-btn q-btn-item non-selectable no-outline bg-secondary text-dark q-btn--standard q-btn--rectangle q-btn--actionable q-btn--dense"
            disabled={busy || !shockerId}
            onClick={() =>
              onCreate({
                Name: name,
                ShockerId: shockerId,
                Intensity: 30,
                Duration: 1000,
                ShockEnabled: true,
                VibrateEnabled: true,
                BeepEnabled: true,
                ShowCountdown: true,
                ShowUsages: true,
                Editable: true,
                ActivateOnLoad: false,
                ForceWarning: false,
                ForceLogin: false,
                SingleUser: false,
              })
            }
          >
            <span className="q-btn__wrapper col row q-anchor--skip">
              <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                <span className="block">Create link</span>
              </span>
            </span>
          </button>
          <button
            type="button"
            className="q-btn q-btn-item non-selectable no-outline text-secondary bg-dark q-btn--outline q-btn--rectangle q-btn--actionable q-btn--dense"
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

      <div className="column q-gutter-sm">
        <div className="text-secondary text-subtitle2">Shared with you</div>
        <div className="q-list q-list--dark q-list--separator">
          {shared.length === 0 ? (
            <div className="text-grey-5 q-pa-sm">No redeemed share codes yet.</div>
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
              (code ? `Share ${code}` : `Share ${id}`);
            const owner = row.Username ?? row.username;
            const paused = Boolean(
              row.Paused ?? row.paused ?? row.SharePaused ?? row.sharePaused,
            );
            return (
              <div key={String(id)} className="q-item q-item-type column q-pa-sm">
                <div className="q-item__label text-secondary">{title}</div>
                <div className="q-item__label q-item__label--caption text-grey-5">
                  {owner ? `${owner} · ` : ''}
                  {code ? `Code ${code} · ` : ''}
                  {paused ? 'Paused' : 'Active'}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="column q-gutter-sm">
        <div className="text-secondary text-subtitle2">Website links</div>
        <div className="q-list q-list--dark q-list--separator">
          {links.length === 0 ? <div className="text-grey-5 q-pa-sm">No links yet.</div> : null}
          {links.map((link) => {
            const id = link.LinkId ?? link.linkId ?? 0;
            const title = link.Name ?? link.name ?? `Link ${id}`;
            const code = link.Code ?? link.code;
            const paused = link.Paused ?? link.paused;
            return (
              <div key={id} className="q-item q-item-type column q-pa-sm">
                <div className="q-item__label text-secondary">{title}</div>
                <div className="q-item__label q-item__label--caption text-grey-5">
                  {code ? `Code ${code} · ` : ''}
                  {paused ? 'Paused' : 'Active'}
                </div>
                <div className="row q-gutter-sm q-mt-sm">
                  <button
                    type="button"
                    className="q-btn q-btn-item non-selectable no-outline text-secondary q-btn--outline q-btn--rectangle q-btn--dense q-btn--actionable"
                    disabled={busy}
                    onClick={() => onPause(id, !paused)}
                  >
                    <span className="q-btn__wrapper col row q-anchor--skip">
                      <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                        <span className="block">{paused ? 'Unpause' : 'Pause'}</span>
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="q-btn q-btn-item non-selectable no-outline text-negative q-btn--outline q-btn--rectangle q-btn--dense q-btn--actionable"
                    disabled={busy}
                    onClick={() => onDelete(id)}
                  >
                    <span className="q-btn__wrapper col row q-anchor--skip">
                      <span className="q-btn__content text-center col items-center q-anchor--skip justify-center row">
                        <span className="block">Delete</span>
                      </span>
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const fieldStyle = {
  background: '#121212',
  color: '#e8e8e8',
  border: '1px solid hsla(0,0%,100%,.28)',
  padding: 8,
} as const;
