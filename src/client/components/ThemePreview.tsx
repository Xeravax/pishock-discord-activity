import { useEffect, useState, type ReactNode } from 'react';
import { ActivityLimitsSettings, type PersonalLimits, type ShareLimitRow } from './ActivityLimitsSettings';
import { ApiKeyRevealPanel } from './ApiKeyRevealPanel';
import { AuthLoadingScreen } from './AuthLoadingScreen';
import { AvailabilitySettings, type ActivityShareConfig } from './AvailabilitySettings';
import { BrandHeader } from './BrandHeader';
import { DefaultMenuPrompt } from './DefaultMenuPrompt';
import { LinkConfirmPanel } from './LinkConfirmPanel';
import { LoginPanel } from './LoginPanel';
import { OfficialLogsPanel, type OfficialLogEntry } from './OfficialLogsPanel';
import { PiShockLinkingScreen } from './PiShockLinkingScreen';
import { PsDialog } from './PsDialog';
import { QueuePanel, type QueuePanelItem, type QueuePanelSettings } from './QueuePanel';
import { SetupDiscordShareScreen } from './SetupDiscordShareScreen';
import { SetupWizard } from './SetupWizard';
import { SharesPanel } from './SharesPanel';
import { DEFAULT_LOG_PRIVACY, LogPrivacySettings } from './LogPrivacySettings';
import { renderLogShareCard, renderLogShareFrames } from '../logShareCard';
import type { ShockerView } from './ShockerCard';
import type { DiscordParticipant } from '../participants';

/**
 * Demo-only gallery (`/?demo` → Theme) that renders every boot screen and
 * settings dialog with mock data so the shared theme can be reviewed without
 * a live Discord / PiShock session.
 */

type Boot =
  | 'loading'
  | 'loading-error'
  | 'linking'
  | 'linking-error'
  | 'wizard'
  | 'api-key'
  | 'confirm'
  | 'setup'
  | 'setup-limits'
  | 'setup-logs'
  | 'setup-features'
  | 'default-menu';

type Dialog = 'limits' | 'limits-shared' | 'availability' | 'shares' | 'login' | 'logs' | 'log-privacy';

const NOOP = () => {};
const loadDemoLogPrivacy = async () => ({ ...DEFAULT_LOG_PRIVACY, visibility: 'server' as const, showIntensity: false });

/** Wide mock profile banner (3:1) so the confirm preview shows the full image */
const DEMO_BANNER = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200">' +
    '<defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="#2fa8dc"/><stop offset="1" stop-color="#1a1500"/></linearGradient></defs>' +
    '<rect width="600" height="200" fill="url(#g)"/>' +
    '<path d="M380 20 L470 20 L430 120 L470 120 L360 190 L400 100 L360 100 Z" fill="#f4d600" opacity=".85"/>' +
    '<text x="24" y="176" font-family="sans-serif" font-size="22" fill="#fff" opacity=".8">banner edge → fully visible</text>' +
    '</svg>',
)}`;

const PERSONAL: PersonalLimits = {
  activityMinIntensity: 1,
  activityMaxIntensity: 60,
  activityMinDurationMs: 300,
  activityMaxDurationMs: 5000,
  activityVibMinIntensity: 1,
  activityVibMaxIntensity: 100,
  activityVibMinDurationMs: 300,
  activityVibMaxDurationMs: 8000,
  activityBeepMinIntensity: 1,
  activityBeepMaxIntensity: 100,
  activityBeepMinDurationMs: 300,
  activityBeepMaxDurationMs: 3000,
  activityCanShock: true,
  activityCanVibrate: true,
  activityCanBeep: true,
  activityCanHold: false,
  activityRequiredWarningLevel: 'none',
};

function shareRow(s: ShockerView): ShareLimitRow & ActivityShareConfig {
  return {
    shockerId: s.id,
    shockerName: s.name,
    hubClientId: s.clientId != null ? String(s.clientId) : null,
    hubName: s.hubName ?? null,
    enabled: true,
    paused: false,
    deviceMaxIntensity: 100,
    deviceMaxDurationMs: 15_000,
    minIntensity: 1,
    maxIntensity: 45,
    minDurationMs: 300,
    maxDurationMs: 4000,
    vibMinIntensity: 1,
    vibMaxIntensity: 100,
    vibMinDurationMs: 300,
    vibMaxDurationMs: 8000,
    beepMinIntensity: 1,
    beepMaxIntensity: 100,
    beepMinDurationMs: 300,
    beepMaxDurationMs: 3000,
    canShock: true,
    canVibrate: true,
    canBeep: true,
    canHold: false,
    requiredWarningLevel: 'small',
  };
}

function person(id: string, displayName: string) {
  return { id, displayName, avatarUrl: `https://cdn.discordapp.com/embed/avatars/${Number(id) % 6}.png` };
}

const LOGS: OfficialLogEntry[] = [
  {
    id: 'l1',
    from: person('111', 'RogerfireFox'),
    to: person('2', 'Local Dev'),
    fromLabel: 'RogerfireFox',
    toLabel: 'Local Dev',
    viaApi: true,
    source: 'discord',
    location: null,
    action: 'shock',
    shockerId: 26515,
    shockerName: 'XeraShocker',
    hubClientId: '16583',
    hubName: 'DevShock',
    warningLevel: 'small',
    intensity: 25,
    durationSec: 1,
    at: Date.now() - 40_000,
  },
  {
    id: 'l2',
    from: person('2', 'Local Dev'),
    to: person('111', 'RogerfireFox'),
    fromLabel: 'Local Dev',
    toLabel: 'RogerfireFox',
    viaApi: false,
    source: 'website',
    location: null,
    action: 'vibrate',
    shockerId: 11663,
    shockerName: 'Leg',
    hubClientId: '7343',
    hubName: 'RogerfireFox',
    warningLevel: null,
    intensity: 60,
    durationSec: 2,
    at: Date.now() - 5 * 60_000,
  },
];

const SHARE_SAMPLES: OfficialLogEntry[] = [
  {
    ...LOGS[0]!,
    id: 'sample-shock-strong',
    action: 'shock',
    from: person('3', 'Xeravax'),
    to: person('111', 'RogerfireFox the Magnificent'),
    location: { kind: 'guild', name: 'The Basement', guildId: '1' },
    intensity: 85,
    durationSec: 1.5,
    warningLevel: 'small',
  },
  {
    ...LOGS[0]!,
    id: 'sample-shock-light',
    action: 'shock',
    from: person('6', 'Kiwi'),
    to: person('7', 'Nova'),
    location: { kind: 'guild', name: 'The Basement', guildId: '1' },
    intensity: 15,
    durationSec: 0.5,
    warningLevel: null,
  },
  {
    ...LOGS[1]!,
    id: 'sample-vibrate',
    from: person('4', 'A very long display name 🎉'),
    to: person('5', 'Bo'),
    location: { kind: 'dm', name: 'Direct Message' },
    intensity: 60,
  },
  {
    ...LOGS[1]!,
    id: 'sample-beep',
    action: 'beep',
    from: person('8', 'Mira'),
    to: person('3', 'Xeravax'),
    location: { kind: 'guild', name: 'The Basement', guildId: '1' },
    intensity: 40,
    durationSec: 1,
    shockerName: 'Arm',
  },
];

/** Every Nth frame of a card laid out in a grid, so motion can be reviewed as stills. */
function FrameSheet({ entry }: { entry: OfficialLogEntry }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { frames } = await renderLogShareFrames(entry);
      const only = new URLSearchParams(window.location.search).get('frame');
      const picks =
        only != null
          ? [frames[Math.min(frames.length - 1, Number(only) || 0)]!]
          : frames.filter((_, i) => i % Math.max(1, Math.round(frames.length / 8)) === 0).slice(0, 8);
      const tw = only != null ? frames[0]!.width / 2 : 640;
      const th = Math.round((tw * frames[0]!.height) / frames[0]!.width);
      const sheet = document.createElement('canvas');
      sheet.width = tw * 2;
      sheet.height = th * Math.ceil(picks.length / 2);
      const sctx = sheet.getContext('2d')!;
      const tmp = document.createElement('canvas');
      tmp.width = frames[0]!.width;
      tmp.height = frames[0]!.height;
      const tctx = tmp.getContext('2d')!;
      picks.forEach((f, i) => {
        tctx.putImageData(f, 0, 0);
        sctx.drawImage(tmp, (i % 2) * tw, Math.floor(i / 2) * th, tw, th);
      });
      if (!cancelled) setUrl(sheet.toDataURL('image/png'));
    })();
    return () => {
      cancelled = true;
    };
  }, [entry]);
  return url ? <img src={url} alt="Frame sheet" className="theme-preview__card" /> : <p className="muted">Rendering…</p>;
}

/** Renders real share-card GIFs so their layout and motion can be reviewed */
function ShareCardPreview() {
  const mode = new URLSearchParams(window.location.search).get('cards');
  const only = new URLSearchParams(window.location.search).get('sample');
  const samples = SHARE_SAMPLES.filter((e) => !only || e.id === `sample-${only}`);
  const [cards, setCards] = useState<Array<{ id: string; url: string; data: string; kb: number }>>([]);
  useEffect(() => {
    if (mode === 'sheet') return;
    let cancelled = false;
    const made: string[] = [];
    void (async () => {
      const out: Array<{ id: string; url: string; data: string; kb: number }> = [];
      for (const entry of samples) {
        try {
          const blob = await renderLogShareCard(entry);
          const url = URL.createObjectURL(blob);
          made.push(url);
          const data = await new Promise<string>((resolve) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result));
            r.readAsDataURL(blob);
          });
          out.push({ id: entry.id, url, data, kb: Math.round(blob.size / 1024) });
        } catch {
          /* ignore in preview */
        }
      }
      if (!cancelled) setCards(out);
    })();
    return () => {
      cancelled = true;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, only]);

  if (mode === 'sheet') {
    return (
      <div className="theme-preview__stack">
        {samples.map((e) => (
          <FrameSheet key={e.id} entry={e} />
        ))}
      </div>
    );
  }
  if (!cards.length) return <p className="muted">Rendering share cards…</p>;
  return (
    <div className="theme-preview__stack">
      {cards.map((c) => (
        <figure key={c.id} style={{ margin: 0 }}>
          <img src={c.url} alt="Share card preview" className="theme-preview__card" />
          <figcaption className="muted" style={{ fontSize: '0.8rem' }}>
            {c.id} · {c.kb} KB
          </figcaption>
          <a hidden data-gif-id={c.id} href={c.data}>
            gif
          </a>
        </figure>
      ))}
    </div>
  );
}

/** Auth loading screen with a looping fake progress so the bar animates */
function LoadingPreview({ error }: { error?: boolean }) {
  const [progress, setProgress] = useState(12);
  useEffect(() => {
    if (error) return;
    const t = window.setInterval(() => setProgress((p) => (p >= 100 ? 8 : p + 7)), 450);
    return () => window.clearInterval(t);
  }, [error]);
  const label =
    progress < 35 ? 'Connecting to Discord…' : progress < 70 ? 'Authorizing…' : 'Loading your devices…';
  return (
    <AuthLoadingScreen
      progress={error ? 64 : progress}
      label={label}
      error={error ? 'Discord did not respond in time. Close the activity and try again.' : null}
    />
  );
}

export function ThemePreview({
  shockers,
  participants,
  onFlash,
}: {
  shockers: ShockerView[];
  participants: DiscordParticipant[];
  onFlash: (msg: string) => void;
}) {
  // Deep links for review: /?demo&theme&preview=setup or &dialog=limits
  const [boot, setBoot] = useState<Boot | null>(
    () => (new URLSearchParams(window.location.search).get('preview') as Boot | null) || null,
  );
  const [dialog, setDialog] = useState<Dialog | null>(
    () => (new URLSearchParams(window.location.search).get('dialog') as Dialog | null) || null,
  );
  const [queueOpen, setQueueOpen] = useState(
    () => new URLSearchParams(window.location.search).has('queue'),
  );
  const owned = shockers.filter((s) => s.owned);

  useEffect(() => {
    if (!boot) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBoot(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [boot]);

  const bootScreens: Array<[Boot, string]> = [
    ['loading', 'Auth loading'],
    ['loading-error', 'Auth error'],
    ['linking', 'PiShock linking'],
    ['linking-error', 'Linking error'],
    ['wizard', 'Setup wizard'],
    ['api-key', 'API key reveal'],
    ['confirm', 'Confirm account'],
    ['setup', 'Discord share setup'],
    ['setup-limits', 'Setup: limits'],
    ['setup-logs', 'Setup: log sharing'],
    ['setup-features', 'Setup: extra features'],
    ['default-menu', 'Default menu'],
  ];
  const dialogs: Array<[Dialog, string]> = [
    ['limits', 'Activity limits'],
    ['availability', 'Available in Discord'],
    ['shares', 'Shares'],
    ['login', 'Link PiShock'],
    ['logs', 'Logs'],
    ['log-privacy', 'Log sharing'],
  ];

  let bootEl: ReactNode = null;
  switch (boot) {
    case 'loading':
      bootEl = <LoadingPreview />;
      break;
    case 'loading-error':
      bootEl = <LoadingPreview error />;
      break;
    case 'linking':
      bootEl = (
        <PiShockLinkingScreen
          label="Waiting for PiShock login in your browser…"
          canReopen
          onReopen={NOOP}
          onCancel={() => setBoot(null)}
        />
      );
      break;
    case 'linking-error':
      bootEl = (
        <PiShockLinkingScreen
          error="The login window was closed before PiShock confirmed your account."
          onRetry={NOOP}
          onCancel={() => setBoot(null)}
        />
      );
      break;
    case 'wizard':
      bootEl = (
        <SetupWizard discordName="Local Dev" onComplete={() => setBoot(null)} onSkipToLogin={() => setBoot(null)} />
      );
      break;
    case 'api-key':
      bootEl = (
        <ApiKeyRevealPanel
          apiKey="ps_live_3f9a7c21e04b4d8b9a1c55e2d7f06b13"
          apiKeyName="Discord Activity"
          pishockUsername="LocalDev"
          error={null}
          onContinue={() => setBoot(null)}
          onExit={() => setBoot(null)}
        />
      );
      break;
    case 'confirm':
      bootEl = (
        <LinkConfirmPanel
          pishockUserId={12345}
          pishockUsername="LocalDev"
          avatarUrl="https://cdn.discordapp.com/embed/avatars/1.png"
          bannerUrl={DEMO_BANNER}
          hubNames={['DevShock', 'Spare hub']}
          discordName="Local Dev"
          onConfirm={() => setBoot(null)}
          onCancel={() => setBoot(null)}
        />
      );
      break;
    case 'setup':
    case 'setup-limits':
    case 'setup-logs':
    case 'setup-features':
      bootEl = (
        <SetupDiscordShareScreen
          shockers={shockers}
          initialPersonal={PERSONAL}
          startStep={
            boot === 'setup-limits'
              ? 'limits'
              : boot === 'setup-logs'
                ? 'logs'
                : boot === 'setup-features'
                  ? 'features'
                  : undefined
          }
          devicesReady
          onComplete={() => setBoot(null)}
          onSkip={() => setBoot(null)}
        />
      );
      break;
    case 'default-menu':
      bootEl = (
        <DefaultMenuPrompt discordName="Local Dev" onDismiss={() => setBoot(null)} onChoose={() => setBoot(null)} />
      );
      break;
    default:
      bootEl = null;
  }

  return (
    <div className="app-shell consent-shell theme-preview">
      <div className="theme-preview__inner">
        <BrandHeader sub="Theme preview" />

        <section className="panel">
          <div className="ps-section-title">Boot &amp; setup screens</div>
          <p className="muted theme-preview__hint">
            Full-screen screens shown before the controller. Press Esc or “Exit preview” to return.
          </p>
          <div className="theme-preview__grid">
            {bootScreens.map(([id, label]) => (
              <button key={id} type="button" className="btn secondary" onClick={() => setBoot(id)}>
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="ps-section-title">Settings dialogs</div>
          <p className="muted theme-preview__hint">Dialogs opened from the controller menu.</p>
          <div className="theme-preview__grid">
            {dialogs.map(([id, label]) => (
              <button key={id} type="button" className="btn secondary" onClick={() => setDialog(id)}>
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="ps-section-title">Command queue</div>
          <p className="muted theme-preview__hint">
            The wearer's queue panel from the bottom rail, with demo people waiting.
          </p>
          <div className="theme-preview__grid">
            <button type="button" className="btn secondary" onClick={() => setQueueOpen((o) => !o)}>
              {queueOpen ? 'Hide queue panel' : 'Show queue panel'}
            </button>
          </div>
        </section>

        {new URLSearchParams(window.location.search).has('cards') ? (
          <section className="panel">
            <div className="ps-section-title">Share cards</div>
            <ShareCardPreview />
          </section>
        ) : null}

        <section className="panel">
          <div className="ps-section-title">Primitives</div>
          <div className="theme-preview__stack">
            <input className="ps-field ps-field--block" placeholder="Text field" />
            <div className="ps-callout">Info callout — neutral status message.</div>
            <div className="ps-callout ps-callout--success">Limits saved. Your control panel caps are updated.</div>
            <div className="ps-callout ps-callout--error">Couldn’t save — PiShock returned an error.</div>
            <div className="btn-row" style={{ marginTop: 0 }}>
              <button type="button" className="btn">
                Primary
              </button>
              <button type="button" className="btn secondary">
                Secondary
              </button>
              <button type="button" className="btn accent">
                Accent
              </button>
            </div>
          </div>
        </section>
      </div>

      {bootEl ? (
        <>
          {bootEl}
          <button type="button" className="btn theme-preview__exit" onClick={() => setBoot(null)}>
            Exit preview
          </button>
        </>
      ) : null}

      <PsDialog
        open={dialog === 'limits' || dialog === 'limits-shared'}
        title="Activity limits"
        onClose={() => setDialog(null)}
        fill
      >
        <ActivityLimitsSettings
          ownedShockers={owned}
          focusShockerId={dialog === 'limits-shared' ? (owned[0]?.id ?? null) : null}
          onLoad={async () => ({ personal: PERSONAL, shares: owned.map(shareRow) })}
          onSave={async () => onFlash('Would save limits')}
          onRevokeConsent={() => onFlash('Would revoke consent')}
        />
      </PsDialog>

      <PsDialog open={dialog === 'availability'} title="Available in Discord" onClose={() => setDialog(null)} wide>
        <AvailabilitySettings
          ownedShockers={owned}
          participants={participants}
          currentUserId="dev-user"
          onLoad={async () => ({ shares: owned.map(shareRow), bannedDiscordUserIds: [], available: true })}
          onSave={async () => onFlash('Would save availability')}
        />
      </PsDialog>

      <PsDialog open={dialog === 'shares'} title="Shares" onClose={() => setDialog(null)} wide>
        <SharesPanel
          shared={[{ ShareId: 16260, ShockerName: 'Leg', Username: 'RogerfireFox', ShareCode: '74EC835FF88' }]}
          shockers={owned.map((s) => ({ id: s.id, name: s.name }))}
          busy={false}
          onCreateShare={() => onFlash('Would create share code')}
          onClaimShare={() => onFlash('Would redeem share code')}
        />
      </PsDialog>

      <PsDialog open={dialog === 'login'} title="Link PiShock" onClose={() => setDialog(null)} wide>
        <LoginPanel
          linking={false}
          loginUrl={null}
          error={null}
          onStart={() => onFlash('Would open PiShock login')}
          onOpen={NOOP}
          onRefresh={NOOP}
          onManualSubmit={() => onFlash('Would validate API key')}
        />
      </PsDialog>

      <PsDialog open={dialog === 'log-privacy'} title="Log sharing" onClose={() => setDialog(null)} wide>
        <LogPrivacySettings
          onLoad={loadDemoLogPrivacy}
          onSave={async (v) => {
            onFlash('Would save log sharing settings');
            return v;
          }}
        />
      </PsDialog>

      <OfficialLogsPanel open={dialog === 'logs'} entries={LOGS} onClose={() => setDialog(null)} />

      {queueOpen ? (
        <div className="official-right-rail">
          <QueuePreview participants={participants} onClose={() => setQueueOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}

function demoQueueItem(
  id: string,
  who: DiscordParticipant | undefined,
  operation: string,
  intensity: number,
  durationMs: number,
  priority = false,
): QueuePanelItem {
  return {
    id,
    executorDiscordUserId: who?.id ?? id,
    executorUsername: who?.displayName ?? 'someone',
    executorGlobalName: who?.displayName ?? null,
    executorAvatar: null,
    operation,
    intensity,
    durationMs,
    hold: false,
    warning: false,
    shockerId: 1,
    enqueuedAt: Date.now(),
    priority,
  };
}

/** Local-state queue so the panel can be clicked through without a server. */
function QueuePreview({
  participants,
  onClose,
}: {
  participants: DiscordParticipant[];
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<QueuePanelSettings>({
    enabled: true,
    progressMs: 1500,
    maxPerSender: 3,
    starOnly: false,
  });
  const [paused, setPaused] = useState(false);
  const [halted, setHalted] = useState(false);
  const [active, setActive] = useState<QueuePanelItem | null>(() =>
    demoQueueItem('q1', participants[0], 'shock', 35, 1000, true),
  );
  const [waiting, setWaiting] = useState<QueuePanelItem[]>(() => [
    demoQueueItem('q2', participants[1], 'vibrate', 60, 2000),
    demoQueueItem('q3', participants[2] ?? participants[0], 'shock', 20, 500),
    demoQueueItem('q4', participants[3] ?? participants[1], 'beep', 0, 1000),
  ]);
  const byId = new Map(participants.map((p) => [p.id, p]));
  return (
    <QueuePanel
      settings={settings}
      paused={paused}
      halted={halted}
      active={active}
      waiting={waiting}
      nextStartsInMs={4000}
      onClose={onClose}
      onSettingsChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
      onTogglePaused={setPaused}
      onToggleHalted={setHalted}
      onSkip={() => {
        setActive(waiting[0] ?? null);
        setWaiting((w) => w.slice(1));
      }}
      onClear={() => setWaiting([])}
      onRemove={(id) => setWaiting((w) => w.filter((i) => i.id !== id))}
      onToggleStar={(userId, starred) => {
        const mark = (i: QueuePanelItem) =>
          i.executorDiscordUserId === userId ? { ...i, priority: starred } : i;
        setActive((a) => (a ? mark(a) : a));
        setWaiting((w) => w.map(mark));
      }}
      displayNameFor={(item) => byId.get(item.executorDiscordUserId)?.displayName ?? 'Someone'}
      avatarUrlFor={(item) =>
        byId.get(item.executorDiscordUserId)?.avatarUrl ?? 'https://cdn.discordapp.com/embed/avatars/0.png'
      }
    />
  );
}
