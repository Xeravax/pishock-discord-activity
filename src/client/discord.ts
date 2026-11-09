import { DiscordSDK, Common, Events } from '@discord/embedded-app-sdk';
import { apiFetch, isEmbedded } from './api';
import { normalizeParticipant, type DiscordParticipant } from './participants';

export type AuthState = {
  accessToken: string;
  user: {
    id: string;
    username: string;
    global_name?: string | null;
    avatar?: string | null;
  };
};

let sdk: DiscordSDK | null = null;

function clientId(): string {
  return import.meta.env.VITE_DISCORD_CLIENT_ID || 'dev_dummy_client_id';
}

export function getDiscordSdk(): DiscordSDK {
  if (sdk) return sdk;
  if (isEmbedded) {
    sdk = new DiscordSDK(clientId(), { disableConsoleLogOverride: true });
  } else {
    const dummyParams = new URLSearchParams({
      frame_id: 'dummy_frame_id',
      instance_id: 'dummy_instance_id',
      platform: 'desktop',
      sdk_version: '1.0.0',
    });
    const originalSearch = window.location.search;
    window.history.replaceState({}, '', `${window.location.pathname}?${dummyParams}`);
    sdk = new DiscordSDK(clientId(), { disableConsoleLogOverride: true });
    window.history.replaceState({}, '', `${window.location.pathname}${originalSearch}`);
  }
  return sdk;
}

export function getActivityInstanceId(): string | null {
  try {
    return getDiscordSdk().instanceId ?? null;
  } catch {
    return null;
  }
}

export type BootstrapProgress = {
  progress: number;
  label: string;
};

export async function bootstrapDiscord(
  onLayout: (pip: boolean) => void,
  onProgress?: (update: BootstrapProgress) => void,
): Promise<AuthState> {
  const report = (progress: number, label: string) => {
    onProgress?.({ progress, label });
  };

  if (!isEmbedded) {
    report(40, 'Local preview…');
    return {
      accessToken: 'dev-token',
      user: {
        id: 'dev-user',
        username: 'DevUser',
        global_name: 'Local Dev',
      },
    };
  }

  report(8, 'Connecting to Discord…');
  const discordSdk = getDiscordSdk();
  await discordSdk.ready();
  report(22, 'Preparing activity…');

  try {
    await discordSdk.commands.setOrientationLockState({
      lock_state: Common.OrientationLockStateTypeObject.UNLOCKED,
      picture_in_picture_lock_state: Common.OrientationLockStateTypeObject.LANDSCAPE,
      grid_lock_state: Common.OrientationLockStateTypeObject.LANDSCAPE,
    });
  } catch {
    // optional
  }

  try {
    const sdkAny = discordSdk as DiscordSDK & {
      subscribeToLayoutModeUpdatesCompat?: (cb: (update: { layout_mode: number }) => void) => void;
    };
    sdkAny.subscribeToLayoutModeUpdatesCompat?.((update) => {
      onLayout(update.layout_mode === Common.LayoutModeTypeObject.PIP);
    });
  } catch {
    // optional
  }

  report(38, 'Authorizing with Discord…');
  const { code } = await discordSdk.commands.authorize({
    client_id: clientId(),
    response_type: 'code',
    state: '',
    prompt: 'none',
    scope: ['identify', 'guilds', 'guilds.members.read', 'rpc.activities.write'],
  });

  report(58, 'Exchanging session…');
  const result = await apiFetch<{
    access_token: string;
    user: AuthState['user'];
  }>('/auth/discord', null, {
    method: 'POST',
    body: JSON.stringify({ code }),
  });

  report(72, 'Signing into activity…');
  await discordSdk.commands.authenticate({ access_token: result.access_token });
  report(82, 'Authenticated');

  return {
    accessToken: result.access_token,
    user: result.user,
  };
}

export async function fetchInstanceParticipants(): Promise<DiscordParticipant[]> {
  if (!isEmbedded) return [];
  const discordSdk = getDiscordSdk();
  const result = await discordSdk.commands.getInstanceConnectedParticipants();
  const list = (result as { participants?: Array<Record<string, unknown>> }).participants ?? [];
  return list.map((p) => normalizeParticipant(p));
}

export function subscribeParticipants(
  onUpdate: (participants: DiscordParticipant[]) => void,
): () => void {
  if (!isEmbedded) return () => undefined;
  const discordSdk = getDiscordSdk();
  const handler = (data: { participants?: Array<Record<string, unknown>> }) => {
    const list = data.participants ?? [];
    onUpdate(list.map((p) => normalizeParticipant(p)));
  };
  try {
    discordSdk.subscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, handler);
  } catch {
    // older SDK / unsupported
  }
  return () => {
    try {
      discordSdk.unsubscribe(Events.ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE, handler);
    } catch {
      // ignore
    }
  };
}

export async function openExternal(url: string) {
  if (isEmbedded) {
    const discordSdk = getDiscordSdk();
    try {
      await discordSdk.commands.openExternalLink({ url });
      return;
    } catch {
      // fall through
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}
