import { useState } from 'react';
import { SafetyWarning } from './components/SafetyWarning';
import { SafetyNotice } from './components/SafetyReminders';
import { SafetyNoticeBar } from './components/SafetyNoticeBar';
import { TermsOfService } from './components/TermsOfService';
import { PrivacyPolicy } from './components/PrivacyPolicy';
import { LoginPanel } from './components/LoginPanel';
import { OfficialController } from './components/OfficialController';
import { SharesPanel } from './components/SharesPanel';
import { CommandLog } from './components/CommandLog';
import { FriendsParticipantList } from './components/FriendsParticipantList';
import { PipIncomingShock } from './components/PipIncomingShock';
import { PsDialog } from './components/PsDialog';
import type { ShockerView } from './components/ShockerCard';
import { participantAvatarUrl, type DiscordParticipant, type ParticipantStatus } from './participants';

type Screen = 'consent' | 'login' | 'control' | 'shares' | 'logs' | 'pip' | 'terms' | 'privacy';
type Overlay = null | 'shares' | 'logs' | 'availability' | 'menu' | 'settings';

const DEMO_PARTICIPANTS: DiscordParticipant[] = [
  {
    id: 'dev-user',
    username: 'DevUser',
    global_name: 'Local Dev',
    displayName: 'Local Dev',
    avatarUrl: participantAvatarUrl('dev-user'),
  },
  {
    id: '111',
    username: 'roger',
    global_name: 'RogerfireFox',
    displayName: 'RogerfireFox',
    avatarUrl: participantAvatarUrl('111'),
  },
  {
    id: '222',
    username: 'offline',
    global_name: 'NotLinked',
    displayName: 'NotLinked',
    avatarUrl: participantAvatarUrl('222'),
  },
];

const DEMO_STATUS: Record<string, ParticipantStatus> = {
  '111': {
    discordUserId: '111',
    username: 'roger',
    globalName: 'RogerfireFox',
    avatar: null,
    linked: true,
    consent: true,
    available: true,
    paused: false,
    emergencyStop: false,
    bannedYou: false,
    shockers: [
      {
        shockerId: 11663,
        shockerName: 'Leg',
        hubClientId: '7343',
        deviceMaxIntensity: 100,
        deviceMaxDurationMs: 15000,
        maxIntensity: 80,
        maxDurationMs: 10000,
        canShock: true,
        canVibrate: true,
        canBeep: true,
        canHold: true,
        paused: false,
        emergencyStop: false,
      },
    ],
  },
  '222': {
    discordUserId: '222',
    username: 'offline',
    globalName: 'NotLinked',
    avatar: null,
    linked: false,
    consent: false,
    available: false,
    paused: false,
    emergencyStop: false,
    bannedYou: false,
    shockers: [],
  },
};

const DEMO_SHOCKERS: ShockerView[] = [
  {
    id: 26515,
    name: 'XeraShocker',
    hubName: 'DevShock',
    clientId: 16583,
    owned: true,
    paused: false,
    canShock: true,
    canVibrate: true,
    canBeep: true,
    canHold: true,
    canPause: false,
    deviceMaxIntensity: 100,
    deviceMaxDuration: 15000,
    activityMaxIntensity: 70,
    activityMaxDuration: 8000,
    maxIntensity: 70,
    maxDuration: 8000,
    isV3: true,
    online: true,
  },
  {
    id: 11663,
    name: 'Leg',
    hubName: 'RogerfireFox',
    clientId: 7343,
    owned: false,
    shareCode: '74EC835FF88',
    shareId: 16260,
    paused: false,
    canShock: true,
    canVibrate: true,
    canBeep: true,
    canHold: true,
    canPause: false,
    deviceMaxIntensity: 100,
    deviceMaxDuration: 15000,
    activityMaxIntensity: 100,
    activityMaxDuration: 15000,
    maxIntensity: 100,
    maxDuration: 15000,
    isV3: true,
    online: false,
  },
];

const DEMO_LINKS = [
  {
    LinkId: 5158,
    ShockerId: 26515,
    Code: '58a93a7b-demo',
    Name: 'Lemonade',
    Paused: false,
    ShockEnabled: true,
    VibrateEnabled: false,
    BeepEnabled: false,
  },
];

const DEMO_LOGS = [
  {
    id: '1',
    action: 'vibrate',
    shockerId: 26515,
    intensity: 20,
    durationMs: 1000,
    success: true,
    detail: null as string | null,
    createdAt: new Date().toISOString(),
  },
  {
    id: '2',
    action: 'beep',
    shockerId: 26515,
    intensity: 1,
    durationMs: 300,
    success: true,
    detail: null as string | null,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
  },
];

export function DemoApp() {
  const [screen, setScreen] = useState<Screen>('control');
  const [toast, setToast] = useState<string | null>(null);
  const [friendsOpen, setFriendsOpen] = useState(true);
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>(['111']);
  const selectedTargetId = selectedTargetIds[0] ?? null;
  const [overlay, setOverlay] = useState<Overlay>(null);
  const demoLinked = true;

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  };

  const friendShockers: ShockerView[] = selectedTargetIds.flatMap((targetId) => {
    const status = DEMO_STATUS[targetId];
    if (!status?.available) return [];
    return status.shockers.map(
      (s): ShockerView => ({
        id: s.shockerId,
        name: s.shockerName,
        hubName: status.globalName ?? 'Friend',
        clientId: s.hubClientId ?? undefined,
        owned: false,
        targetDiscordUserId: targetId,
        canShock: s.canShock,
        canVibrate: s.canVibrate,
        canBeep: s.canBeep,
        canHold: s.canHold,
        canPause: false,
        deviceMaxIntensity: s.deviceMaxIntensity,
        deviceMaxDuration: s.deviceMaxDurationMs,
        activityMaxIntensity: s.maxIntensity,
        activityMaxDuration: s.maxDurationMs,
        maxIntensity: s.maxIntensity,
        maxDuration: s.maxDurationMs,
        isV3: true,
        online: true,
      }),
    );
  });

  const shockers = friendsOpen ? friendShockers : DEMO_SHOCKERS.filter((s) => s.owned);

  if (screen === 'terms') {
    return <TermsOfService onBack={() => setScreen('consent')} />;
  }
  if (screen === 'privacy') {
    return <PrivacyPolicy onBack={() => setScreen('consent')} />;
  }

  return (
    <div>
      <div className="demo-chrome">
        <h2>UI demo — official controller clone</h2>
        <p>Mock data only. Switch screens; Control/PIP use the real PiShock layout.</p>
        <div className="btn-row">
          {(
            [
              ['consent', 'Safety'],
              ['login', 'Link PiShock'],
              ['control', 'Control'],
              ['shares', 'Shares'],
              ['logs', 'Logs'],
              ['pip', 'PIP layout'],
              ['terms', 'Terms'],
              ['privacy', 'Privacy'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`btn ${screen === id ? 'active' : ''}`}
              onClick={() => setScreen(id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {toast ? (
        <div className="error-banner" style={{ borderColor: 'var(--ps-cyan)', color: 'var(--ps-cyan)' }}>
          {toast}
        </div>
      ) : null}

      {screen === 'consent' ? (
        <div className="app-shell">
          <SafetyWarning
            onAccept={() => setScreen('login')}
            busy={false}
            onOpenTerms={() => setScreen('terms')}
            onOpenPrivacy={() => setScreen('privacy')}
          />
        </div>
      ) : null}

      {screen === 'login' ? (
        <div className="app-shell">
          <SafetyNotice />
          <LoginPanel
            linking={false}
            loginUrl="https://login.pishock.com?proto=socket&channel=demo"
            error={null}
            onStart={() => flash('Would open PiShock Discord login')}
            onOpen={() => flash('Would reopen login URL')}
            onRefresh={() => flash('Would poll login status')}
          />
          <div className="btn-row">
            <button type="button" className="btn secondary" onClick={() => setScreen('terms')}>
              Terms
            </button>
            <button type="button" className="btn secondary" onClick={() => setScreen('privacy')}>
              Privacy
            </button>
          </div>
        </div>
      ) : null}

      {screen === 'pip' ? (
        <div style={{ height: 160, width: 280, margin: 16, border: '1px solid #333' }}>
          <PipIncomingShock
            hit={{
              executorDiscordUserId: '111',
              displayName: 'RogerfireFox',
              avatarUrl: participantAvatarUrl('111'),
              action: 'participant_shock',
              intensity: 42,
              durationMs: 1000,
              at: Date.now() - 4000,
              success: true,
            }}
          />
        </div>
      ) : null}

      {screen === 'shares' || screen === 'logs' || screen === 'control' ? (
        <div className="official-activity-root">
          <OfficialController
            hub={{
              id: friendsOpen ? selectedTargetId || 'friends' : '16583',
              name: friendsOpen
                ? DEMO_PARTICIPANTS.find((p) => p.id === selectedTargetId)?.displayName || 'Discord Shockers'
                : 'DevShock',
              online: friendsOpen ? friendShockers.length > 0 : true,
              lastSeen: friendsOpen ? 'Activity share' : 'Seen a few seconds ago',
            }}
            shockers={shockers}
            friendsOpen={friendsOpen}
            showOwnMode={demoLinked}
            safetyBanner={<SafetyNoticeBar />}
            friendsPanel={({ multiShock }) => (
              <FriendsParticipantList
                participants={DEMO_PARTICIPANTS}
                statuses={DEMO_STATUS}
                currentUserId="dev-user"
                selectedTargetId={selectedTargetId}
                selectedTargetIds={selectedTargetIds}
                multiSelect={multiShock}
                onSelect={(id) => {
                  if (!id) {
                    setSelectedTargetIds([]);
                    return;
                  }
                  if (multiShock) {
                    setSelectedTargetIds((prev) =>
                      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
                    );
                    return;
                  }
                  setSelectedTargetIds((prev) =>
                    prev.length === 1 && prev[0] === id ? [] : [id],
                  );
                }}
                onRefresh={() => flash('Would refresh Discord participants')}
              />
            )}
            onOperate={(input) =>
              flash(
                `${friendsOpen ? 'participant ' : ''}${input.operation} · id ${input.shockerId}${
                  input.targetDiscordUserId ? ` · user ${input.targetDiscordUserId}` : ''
                } · ${input.intensity}% · ${input.durationMs}ms${
                  input.hold ? ' · hold' : ''
                }${input.warning ? ' · warn' : ''}`,
              )
            }
            onOpenFriends={() => {
              setFriendsOpen(true);
              flash('Showing Discord Shockers');
            }}
            onOpenOwnShockers={() => {
              setFriendsOpen(false);
              flash('Showing owned hub');
            }}
            onOpenMenu={() => setOverlay('menu')}
            onOpenShockerSettings={(s) => {
              setOverlay('settings');
              flash(`Would open settings for ${s.name}`);
            }}
            onSelectHub={() => flash('Hub selector')}
            onShareShocker={(s) => {
              flash(`Would share ${s.name}`);
              setOverlay('shares');
            }}
            onPair={(s) => flash(`Would pair ${s.name}`)}
          />

          <PsDialog
            open={overlay === 'menu'}
            title="Menu"
            onClose={() => setOverlay(null)}
          >
            <div className="q-list q-list--dark">
              <button
                type="button"
                className="q-item q-item-type row no-wrap full-width bg-transparent text-left cursor-pointer"
                onClick={() => setOverlay('availability')}
              >
                <div className="q-item__label text-grey-3">Available in Discord</div>
              </button>
              <button
                type="button"
                className="q-item q-item-type row no-wrap full-width bg-transparent text-left cursor-pointer"
                onClick={() => setOverlay('shares')}
              >
                <div className="q-item__label text-grey-3">Shares & links</div>
              </button>
              <button
                type="button"
                className="q-item q-item-type row no-wrap full-width bg-transparent text-left cursor-pointer"
                onClick={() => setOverlay('logs')}
              >
                <div className="q-item__label text-grey-3">Command log</div>
              </button>
            </div>
          </PsDialog>

          <PsDialog
            open={overlay === 'shares' || screen === 'shares'}
            title="Shares & links"
            onClose={() => {
              setOverlay(null);
              if (screen === 'shares') setScreen('control');
            }}
            wide
          >
            <SharesPanel
              links={DEMO_LINKS}
              shared={[]}
              shockers={DEMO_SHOCKERS.filter((s) => s.owned).map((s) => ({ id: s.id, name: s.name }))}
              busy={false}
              onCreate={() => flash('Would create link')}
              onPause={() => flash('Would pause link')}
              onDelete={() => flash('Would delete link')}
              onCreateShare={() => flash('Would create share code')}
              onClaimShare={() => flash('Would redeem share code')}
            />
          </PsDialog>

          <PsDialog
            open={overlay === 'logs' || screen === 'logs'}
            title="Command log"
            onClose={() => {
              setOverlay(null);
              if (screen === 'logs') setScreen('control');
            }}
            wide
          >
            <CommandLog rows={DEMO_LOGS} />
          </PsDialog>

          <PsDialog
            open={overlay === 'availability'}
            title="Available in Discord"
            onClose={() => setOverlay(null)}
            wide
          >
            <div className="text-grey-5 text-body2">
              Demo only — availability settings open here in the live app.
            </div>
          </PsDialog>
        </div>
      ) : null}
    </div>
  );
}
