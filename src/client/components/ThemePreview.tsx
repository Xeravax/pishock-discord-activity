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
import { SetupDiscordShareScreen } from './SetupDiscordShareScreen';
import { SetupWizard } from './SetupWizard';
import { SharesPanel } from './SharesPanel';
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
  | 'default-menu';

type Dialog = 'limits' | 'availability' | 'shares' | 'login' | 'logs';

const NOOP = () => {};

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
    ['default-menu', 'Default menu'],
  ];
  const dialogs: Array<[Dialog, string]> = [
    ['limits', 'Activity limits'],
    ['availability', 'Available in Discord'],
    ['shares', 'Shares'],
    ['login', 'Link PiShock'],
    ['logs', 'Logs'],
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
      bootEl = (
        <SetupDiscordShareScreen
          shockers={shockers}
          initialPersonal={PERSONAL}
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

      <PsDialog open={dialog === 'limits'} title="Activity limits" onClose={() => setDialog(null)} fill>
        <ActivityLimitsSettings
          ownedShockers={owned}
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

      <OfficialLogsPanel open={dialog === 'logs'} entries={LOGS} onClose={() => setDialog(null)} />
    </div>
  );
}
