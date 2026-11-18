import { useLayoutEffect, useState } from 'react';
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
import { PipIncomingShock, type PipControls } from './components/PipIncomingShock';
import { PsDialog } from './components/PsDialog';
import { ThemePreview } from './components/ThemePreview';
import { GlobalBanScreen } from './components/GlobalBanScreen';
import { AdminPanel } from './components/AdminPanel';
import { RouletteStartDialog, RouletteSpinOverlay } from './components/Roulette';
import { SafetyFeaturesSettings } from './components/SafetyFeaturesSettings';
import { MyHistoryPanel } from './components/MyHistoryPanel';
import { MyDataPanel } from './components/MyDataPanel';
import { PersonLimitsDialog } from './components/PersonLimitsDialog';
import { DEFAULT_WEARER_SAFETY, type SafetySnapshot } from './safety';
import type { ShockerView } from './components/ShockerCard';
import { participantAvatarUrl, type DiscordParticipant, type ParticipantStatus } from './participants';

type Screen =
  | 'consent'
  | 'login'
  | 'control'
  | 'shares'
  | 'logs'
  | 'pip'
  | 'terms'
  | 'privacy'
  | 'theme'
  | 'ban'
  | 'admin'
  | 'dialogs';
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
    id: '333',
    username: 'mira',
    global_name: 'Mira',
    displayName: 'Mira',
    avatarUrl: participantAvatarUrl('333'),
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
        minIntensity: 1,
        maxIntensity: 80,
        minDurationMs: 16,
        maxDurationMs: 10000,
        canShock: true,
        canVibrate: true,
        canBeep: true,
        canHold: true,
        paused: false,
        emergencyStop: false,
      },
      {
        shockerId: 11664,
        shockerName: 'Collar',
        hubClientId: '7343',
        deviceMaxIntensity: 100,
        deviceMaxDurationMs: 15000,
        minIntensity: 1,
        maxIntensity: 40,
        minDurationMs: 16,
        maxDurationMs: 5000,
        canShock: true,
        canVibrate: true,
        canBeep: true,
        canHold: false,
        paused: false,
        emergencyStop: false,
      },
    ],
  },
  '333': {
    discordUserId: '333',
    username: 'mira',
    globalName: 'Mira',
    avatar: null,
    linked: true,
    consent: true,
    available: true,
    paused: false,
    emergencyStop: false,
    bannedYou: false,
    shockers: [
      {
        shockerId: 22001,
        shockerName: 'Arm',
        hubClientId: '9001',
        deviceMaxIntensity: 100,
        deviceMaxDurationMs: 15000,
        minIntensity: 1,
        maxIntensity: 60,
        minDurationMs: 16,
        maxDurationMs: 8000,
        canShock: true,
        canVibrate: true,
        canBeep: false,
        canHold: true,
        paused: false,
        emergencyStop: false,
      },
      {
        shockerId: 22002,
        shockerName: 'Chest',
        hubClientId: '9002',
        deviceMaxIntensity: 100,
        deviceMaxDurationMs: 15000,
        minIntensity: 1,
        maxIntensity: 100,
        minDurationMs: 16,
        maxDurationMs: 15000,
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
    activityMinIntensity: 1,
    activityMaxIntensity: 70,
    activityMinDuration: 16,
    activityMaxDuration: 8000,
    minIntensity: 1,
    maxIntensity: 70,
    minDuration: 16,
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
    activityMinIntensity: 1,
    activityMaxIntensity: 100,
    activityMinDuration: 16,
    activityMaxDuration: 15000,
    minIntensity: 1,
    maxIntensity: 100,
    minDuration: 16,
    maxDuration: 15000,
    isV3: true,
    online: false,
  },
];

/** Fixed clock for mock timestamps (render must stay pure). */
const DEMO_NOW = Date.now();

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

const DEMO_BAN = {
  id: 'ban_demo_abc123',
  reason:
    'Repeatedly ignored activity limits and continued after warnings from moderators. Contact the community if you believe this was a mistake.',
  createdAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
  expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60_000).toISOString(),
  appealUrl: 'https://discord.gg/example',
};

const DEMO_ADMIN_OVERVIEW = {
  users: 128,
  consented: 96,
  pishockLinked: 74,
  sharing: 31,
  activeBans: 2,
  commands24h: { shock: 412, vibrate: 880, beep: 210 },
  adminBypasses7d: 3,
  emergencyStopsEngaged: 1,
  pendingDeletions: 0,
  live: { sockets: 18, users: 12, instances: 4 },
  version: 'demo',
  uptimeMs: 3 * 60 * 60_000 + 12 * 60_000,
  admins: [{ id: '999', name: 'Local Admin' }],
  notice: {
    text: 'Demo notice — maintenance tonight at 22:00 UTC.',
    level: 'info' as const,
    expiresAt: null,
    updatedAt: new Date().toISOString(),
  },
};

const DEMO_ADMIN_USERS = [
  {
    id: '111',
    username: 'roger',
    globalName: 'RogerfireFox',
    avatar: null,
    lastSeenAt: new Date().toISOString(),
    banned: false,
    online: true,
    isAdmin: false,
  },
  {
    id: '333',
    username: 'mira',
    globalName: 'Mira',
    avatar: null,
    lastSeenAt: new Date(Date.now() - 3600_000).toISOString(),
    banned: true,
    online: false,
    isAdmin: false,
  },
  {
    id: '999',
    username: 'admin',
    globalName: 'Local Admin',
    avatar: null,
    lastSeenAt: new Date().toISOString(),
    banned: false,
    online: true,
    isAdmin: true,
  },
];

function demoAdminJson(path: string): unknown {
  if (path.includes('/admin/overview')) return DEMO_ADMIN_OVERVIEW;
  if (path.includes('/admin/users?') || path.endsWith('/admin/users')) {
    return { users: DEMO_ADMIN_USERS };
  }
  if (/\/admin\/users\/\d+$/.test(path)) {
    const id = path.split('/').pop()!;
    const row = DEMO_ADMIN_USERS.find((u) => u.id === id) ?? DEMO_ADMIN_USERS[0]!;
    return {
      profile: {
        id: row.id,
        username: row.username,
        globalName: row.globalName,
        avatar: row.avatar,
        firstSeenAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
        lastSeenAt: row.lastSeenAt,
        online: row.online,
        isAdmin: row.isAdmin,
        consented: true,
        pishockLinked: true,
        shares: { total: 2, enabled: 1, paused: 1 },
        features: {
          commandQueue: true,
          favoritesOnly: false,
          approveEach: false,
          budget: false,
          checkIns: true,
          perPersonLimits: true,
          roulette: true,
          recapDms: false,
          adminLimitConsent: false,
        },
        emergencyStopEngaged: false,
        stats: {
          windowDays: 30,
          sent: { shock: 12, vibrate: 40 },
          received: { shock: 8, vibrate: 22, beep: 3 },
          adminBypassesReceived: 0,
        },
        blockedByCount: 1,
        blocksSetCount: 0,
        deletionPending: false,
        bans: row.banned
          ? [
              {
                id: 'ban_demo_abc123',
                reason: DEMO_BAN.reason,
                createdAt: DEMO_BAN.createdAt,
                expiresAt: DEMO_BAN.expiresAt,
                active: true,
                bannedBy: '999',
                liftedAt: null,
                liftedBy: null,
                liftReason: null,
              },
            ]
          : [],
      },
      names: { '999': 'Local Admin' },
    };
  }
  if (path.includes('/admin/bans')) {
    return {
      bans: [
        {
          id: 'ban_demo_abc123',
          discordUserId: '333',
          reason: DEMO_BAN.reason,
          createdAt: DEMO_BAN.createdAt,
          expiresAt: DEMO_BAN.expiresAt,
          active: true,
          bannedBy: '999',
          liftedAt: null,
          liftedBy: null,
          liftReason: null,
        },
      ],
      names: { '333': 'Mira', '999': 'Local Admin' },
    };
  }
  if (path.includes('/admin/audit')) {
    return {
      entries: [
        {
          id: 'a1',
          adminDiscordUserId: '999',
          action: 'ban',
          targetDiscordUserId: '333',
          detail: null,
          createdAt: DEMO_BAN.createdAt,
        },
        {
          id: 'a2',
          adminDiscordUserId: '999',
          action: 'view_profile',
          targetDiscordUserId: '111',
          detail: null,
          createdAt: new Date(Date.now() - 60_000).toISOString(),
        },
        {
          id: 'a3',
          adminDiscordUserId: '999',
          action: 'set_notice',
          targetDiscordUserId: null,
          detail: null,
          createdAt: new Date(Date.now() - 120_000).toISOString(),
        },
      ],
      names: { '999': 'Local Admin', '333': 'Mira', '111': 'RogerfireFox' },
    };
  }
  if (path.includes('/admin/notice')) {
    return { ok: true, notice: DEMO_ADMIN_OVERVIEW.notice };
  }
  if (path.includes('/me/sessions')) return DEMO_SESSIONS;
  if (path.includes('/community')) return { enabled: true, inviteUrl: 'https://discord.gg/example' };
  if (path.includes('/me/history')) return DEMO_HISTORY;
  if (path.includes('/me/data')) return { data: DEMO_DATA };
  return { ok: true };
}

const DEMO_SESSIONS = {
  dmFailed: false,
  sessions: [
    {
      id: 'sess1',
      startedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
      endedAt: new Date(Date.now() - 75 * 60_000).toISOString(),
      dmStatus: 'sent' as const,
      seenAt: null,
      summary: {
        durationMs: 45 * 60_000,
        commands: 24,
        shocks: 9,
        vibrates: 12,
        beeps: 3,
        totalShockMs: 9_000,
        maxShockIntensity: 40,
        refused: 1,
        adminBypasses: 0,
        rouletteSafe: 1,
        topSenders: [
          { id: '111', count: 14 },
          { id: '333', count: 10 },
        ],
      },
    },
  ],
};

const DEMO_HISTORY = {
  nextCursor: null,
  entries: (['participant_shock', 'participant_vibrate', 'participant_beep'] as const).map(
    (action, i) => ({
      id: `h${i}`,
      action,
      shockerName: 'Collar',
      hubName: 'DevShock',
      intensity: action === 'participant_beep' ? null : 20 + i * 10,
      durationMs: 1_000,
      warningLevel: i === 0 ? 'small' : null,
      success: true,
      source: 'activity',
      locationName: 'Demo server · #general',
      createdAt: new Date(Date.now() - (i + 1) * 5 * 60_000).toISOString(),
      adminBypass: false,
      bypassedGates: [],
      refusedReason: null,
      executor: { id: '111', username: 'roger', globalName: 'RogerfireFox', avatar: null },
    }),
  ),
};

const DEMO_DATA = {
  profile: {
    id: 'dev-user',
    username: 'localdev',
    globalName: 'Local Dev',
    consentAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    createdAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    lastSeenAt: new Date().toISOString(),
    logRetentionDays: 365,
    adminLimitOverrideConsentAt: null,
  },
  pishock: {
    pishockUsername: 'localdev',
    pishockUserId: 12345,
    createdAt: new Date(Date.now() - 20 * 86_400_000).toISOString(),
    apiKey: 'stored encrypted',
  },
  counts: {
    shares: 2,
    blocks: 0,
    favorites: 1,
    personLimits: 1,
    logsOwned: 140,
    logsAboutYou: 96,
    logsByYou: 51,
  },
  oldestLogAt: new Date(Date.now() - 19 * 86_400_000).toISOString(),
  retentionDays: 365,
  deletion: null,
};

const DEMO_SAFETY: SafetySnapshot = {
  settings: {
    ...DEFAULT_WEARER_SAFETY,
    budgetEnabled: true,
    budgetMaxShocks: 20,
    checkInEnabled: true,
    rouletteAllowed: true,
  },
  budget: { usedShocks: 6, usedShockMs: 6_000, periodStartedAt: new Date().toISOString() },
  pendingApprovals: [],
  checkInDeadline: null,
  adminConsent: { granted: false, grantedAt: null, version: 1, phrase: 'I CONSENT' },
};

/** Intercept /api/admin/*, /api/me/* and /api/community so panels work offline in ?demo. */
function useDemoAdminFetch(enabled: boolean): boolean {
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    // `enabled && ready` below already hides the stale flag; no reset needed here.
    if (!enabled) return;
    const original = window.fetch.bind(window);
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (
        url.includes('/api/admin') ||
        url.includes('/admin/') ||
        url.includes('/me/') ||
        url.includes('/community')
      ) {
        const body = JSON.stringify(demoAdminJson(url));
        return new Response(body, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return original(input, init);
    };
    setReady(true);
    return () => {
      window.fetch = original;
      setReady(false);
    };
  }, [enabled]);
  return enabled && ready;
}

export function DemoApp() {
  const [screen, setScreen] = useState<Screen>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('theme')) return 'theme';
    return (params.get('screen') as Screen | null) || 'control';
  });
  const [toast, setToast] = useState<string | null>(null);
  const [friendsOpen, setFriendsOpen] = useState(true);
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>(['111', '333']);
  const selectedTargetId = selectedTargetIds[0] ?? null;
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [dialogDemo, setDialogDemo] = useState<
    | null
    | 'roulette'
    | 'spin'
    | 'menu'
    | 'shares'
    | 'logs'
    | 'safety'
    | 'history'
    | 'myData'
    | 'personLimits'
  >(() => {
    const d = new URLSearchParams(window.location.search).get('dialog');
    return (d as 'roulette' | null) ?? 'roulette';
  });
  const demoLinked = true;
  const adminFetchReady = useDemoAdminFetch(screen === 'admin' || screen === 'dialogs');

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

  if (screen === 'ban') {
    return (
      <div>
        <div className="demo-chrome">
          <h2>UI demo — global ban screen</h2>
          <div className="btn-row">
            <button type="button" className="btn" onClick={() => setScreen('control')}>
              Back to control
            </button>
          </div>
        </div>
        <GlobalBanScreen ban={DEMO_BAN} token={null} displayName="Local Dev" />
      </div>
    );
  }

  return (
    <div className={screen === 'theme' ? 'demo-root--scroll' : undefined}>
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
              ['ban', 'Banned'],
              ['admin', 'Admin'],
              ['dialogs', 'Dialogs'],
              ['terms', 'Terms'],
              ['privacy', 'Privacy'],
              ['theme', 'Theme'],
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
        <div className="ps-callout demo-toast" role="status">
          {toast}
        </div>
      ) : null}

      {screen === 'theme' ? (
        <ThemePreview shockers={DEMO_SHOCKERS} participants={DEMO_PARTICIPANTS} onFlash={flash} />
      ) : null}

      {screen === 'consent' ? (
        <div className="app-shell consent-shell">
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

      {screen === 'admin' ? (
        <div className="official-activity-root" style={{ padding: 12 }}>
          <PsDialog open title="Admin panel" onClose={() => setScreen('control')} fill>
            {adminFetchReady ? <AdminPanel token="demo-token" /> : <div className="admin-muted">Loading…</div>}
          </PsDialog>
        </div>
      ) : null}

      {screen === 'dialogs' ? (
        <div className="official-activity-root" style={{ minHeight: 600, position: 'relative' }}>
          <div className="demo-chrome" style={{ marginBottom: 8 }}>
            <div className="btn-row">
              {(
                [
                  ['roulette', 'Roulette start'],
                  ['spin', 'Roulette spin'],
                  ['menu', 'Menu'],
                  ['shares', 'Shares'],
                  ['logs', 'Logs'],
                  ['safety', 'Extra features'],
                  ['history', 'My history'],
                  ['myData', 'My data'],
                  ['personLimits', 'Person limits'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`btn ${dialogDemo === id ? 'active' : ''}`}
                  onClick={() => setDialogDemo(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <RouletteStartDialog
            open={dialogDemo === 'roulette'}
            targetName="RogerfireFox"
            onClose={() => setDialogDemo(null)}
            onStart={() => flash('Would spin')}
          />
          {dialogDemo === 'spin' ? (
            <RouletteSpinOverlay
              spin={{
                spinId: 'spin1',
                targetName: 'RogerfireFox',
                segments: [
                  { action: 'shock', intensity: 20, durationMs: 1000 },
                  { action: 'vibrate', intensity: 40, durationMs: 2000 },
                  { action: 'beep', intensity: 1, durationMs: 300 },
                  { action: 'safe', intensity: 0, durationMs: 0 },
                ],
                resultIndex: 1,
                startsAtLocal: DEMO_NOW - 500,
                spinMs: 2500,
              }}
              onClose={() => setDialogDemo(null)}
            />
          ) : null}
          <PsDialog open={dialogDemo === 'menu'} title="Menu" onClose={() => setDialogDemo(null)}>
            <div className="q-list q-list--dark menu-action-list">
              <div className="q-pa-sm text-caption text-grey-5">Demo menu dialog</div>
              <div className="q-item q-item-type row no-wrap">
                <div className="q-item__label text-grey-3">Admin panel</div>
              </div>
              <div className="q-item q-item-type row no-wrap">
                <div className="q-item__label text-grey-3">My data</div>
              </div>
            </div>
          </PsDialog>
          <PsDialog
            open={dialogDemo === 'shares'}
            title="Shares"
            onClose={() => setDialogDemo(null)}
            wide
          >
            <SharesPanel
              shared={[]}
              shockers={DEMO_SHOCKERS.filter((s) => s.owned).map((s) => ({ id: s.id, name: s.name }))}
              busy={false}
              onCreateShare={() => flash('Would create share code')}
              onClaimShare={() => flash('Would redeem share code')}
            />
          </PsDialog>
          <PsDialog
            open={dialogDemo === 'logs'}
            title="Command log"
            onClose={() => setDialogDemo(null)}
            wide
          >
            <CommandLog rows={DEMO_LOGS} />
          </PsDialog>
          <PsDialog
            open={dialogDemo === 'safety'}
            title="Extra features"
            onClose={() => setDialogDemo(null)}
            wide
          >
            <SafetyFeaturesSettings
              onLoad={async () => DEMO_SAFETY}
              onSave={async (settings) => {
                flash('Would save extra features');
                return { ...DEMO_SAFETY, settings };
              }}
              onResetBudget={async () => DEMO_SAFETY}
              onRaiseBudget={async () => DEMO_SAFETY}
              onAdminConsentStep={() => Promise.reject(new Error('Demo only'))}
              onRevokeAdminConsent={async () => DEMO_SAFETY.adminConsent}
              queueEnabled
            />
          </PsDialog>
          <PsDialog
            open={dialogDemo === 'history'}
            title="My history"
            onClose={() => setDialogDemo(null)}
            wide
          >
            {adminFetchReady ? <MyHistoryPanel token="demo-token" /> : null}
          </PsDialog>
          <PsDialog
            open={dialogDemo === 'myData'}
            title="My data"
            onClose={() => setDialogDemo(null)}
            wide
          >
            {adminFetchReady ? <MyDataPanel token="demo-token" /> : null}
          </PsDialog>
          <PersonLimitsDialog
            open={dialogDemo === 'personLimits'}
            personName="RogerfireFox"
            initial={null}
            onClose={() => setDialogDemo(null)}
            onSave={async () => flash('Would save person limits')}
            onClear={async () => flash('Would clear person limits')}
          />
        </div>
      ) : null}

      {screen === 'pip' ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, margin: 16 }}>
          <div style={{ height: 160, width: 280, border: '1px solid #333' }}>
            <PipIncomingShock
              hit={{
                executorDiscordUserId: '111',
                displayName: 'RogerfireFox',
                avatarUrl: participantAvatarUrl('111'),
                action: 'participant_shock',
                intensity: 42,
                durationMs: 1000,
                at: DEMO_NOW - 4000,
                success: true,
                kind: 'activity',
                targetDiscordUserId: '222',
                targetDisplayName: 'NotLinked',
                targetAvatarUrl: participantAvatarUrl('222'),
              }}
            />
          </div>
          {[
            { w: 330, h: 400 },
            { w: 300, h: 180 },
          ].map(({ w, h }) => (
            <div key={`${w}x${h}`} style={{ height: h, width: w, border: '1px solid #333' }}>
              <DemoPipInteractive />
            </div>
          ))}
        </div>
      ) : null}

      {screen === 'shares' || screen === 'logs' || screen === 'control' ? (
        <div className="official-activity-root">
          <OfficialController
            hub={{
              id: friendsOpen ? selectedTargetId || 'friends' : '16583',
              name: friendsOpen
                ? DEMO_PARTICIPANTS.find((p) => p.id === selectedTargetId)?.displayName ||
                  'Discord Shockers'
                : 'DevShock',
              online: friendsOpen ? friendShockers.length > 0 : true,
              lastSeen: friendsOpen ? 'Activity share' : 'Seen a few seconds ago',
            }}
            shockers={shockers}
            friendsOpen={friendsOpen}
            showOwnMode={demoLinked}
            safetyBanner={<SafetyNoticeBar />}
            personName={(id) =>
              DEMO_PARTICIPANTS.find((p) => p.id === id)?.displayName ?? 'Someone'
            }
            friendsPanel={({ multiShock, individualIntensity }) => (
              <FriendsParticipantList
                participants={DEMO_PARTICIPANTS}
                statuses={DEMO_STATUS}
                currentUserId="dev-user"
                selectedTargetId={selectedTargetId}
                selectedTargetIds={selectedTargetIds}
                multiSelect={multiShock}
                individualIntensity={individualIntensity}
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

          <PsDialog open={overlay === 'menu'} title="Menu" onClose={() => setOverlay(null)}>
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
                <div className="q-item__label text-grey-3">Shares</div>
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
            title="Shares"
            onClose={() => {
              setOverlay(null);
              if (screen === 'shares') setScreen('control');
            }}
            wide
          >
            <SharesPanel
              shared={[]}
              shockers={DEMO_SHOCKERS.filter((s) => s.owned).map((s) => ({ id: s.id, name: s.name }))}
              busy={false}
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

/** Linked-owner PIP with quick actions, backed by local mock state. */
function DemoPipInteractive() {
  const [stopped, setStopped] = useState(false);
  const [paused, setPaused] = useState(false);
  const [stars, setStars] = useState<Set<string>>(() => new Set());
  const [blocked, setBlocked] = useState<Set<string>>(() => new Set());
  const toggle = (set: Set<string>, id: string, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  };
  const controls: PipControls = {
    selfDiscordUserId: '999',
    stopTargetCount: 2,
    stoppedCount: stopped ? 2 : 0,
    onEmergencyStop: setStopped,
    queueEnabled: true,
    queuePaused: paused,
    queueHasActive: true,
    onToggleQueuePaused: setPaused,
    onSkipActive: () => undefined,
    isStarred: (id) => stars.has(id),
    isBlocked: (id) => blocked.has(id),
    onToggleStar: (id, on) => setStars((s) => toggle(s, id, on)),
    onToggleBlock: (id, on) => setBlocked((s) => toggle(s, id, on)),
    busy: false,
    message: null,
  };
  return (
    <PipIncomingShock
      controls={controls}
      hit={{
        executorDiscordUserId: '111',
        displayName: 'Xeravax',
        avatarUrl: participantAvatarUrl('111'),
        action: 'shock',
        intensity: 100,
        durationMs: 1000,
        at: DEMO_NOW - 4000,
        success: true,
        kind: 'personal',
      }}
      queueNext={{
        executorDiscordUserId: '333',
        displayName: 'RogerfireFox',
        avatarUrl: participantAvatarUrl('333'),
        operation: 'vibrate',
        intensity: 40,
        durationMs: 2000,
        estimatedStartAt: DEMO_NOW + 12_000,
        startsInMs: 12_000,
      }}
    />
  );
}
