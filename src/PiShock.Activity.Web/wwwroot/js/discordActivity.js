window.discordSdk = (function () {
  let sdk = null;
  let clientId = "dev_dummy_client_id";
  let participantsHandler = null;
  let layoutRef = null;

  // Embedded App SDK enum values (the vendored bundle only exports DiscordSDK)
  const EVENT_PARTICIPANTS = "ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE";
  const EVENT_LAYOUT = "ACTIVITY_LAYOUT_MODE_UPDATE";
  const LAYOUT_PIP = 1;
  const ORIENTATION_UNLOCKED = 1;
  const ORIENTATION_LANDSCAPE = 3;
  const LOCATION_HINT_TTL_MS = 5 * 60 * 1000;
  let locationHintCache = null;

  function isEmbedded() {
    return new URLSearchParams(window.location.search).has("frame_id");
  }

  function apiBase() {
    return isEmbedded() ? "/.proxy/api" : "/api";
  }

  async function loadClientId() {
    try {
      const res = await fetch("appsettings.json", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        if (json.DiscordClientId) clientId = String(json.DiscordClientId);
      }
    } catch (_) {}
  }

  function reportLayout(mode) {
    try {
      layoutRef?.invokeMethodAsync("OnLayoutChanged", mode === LAYOUT_PIP);
    } catch (_) {}
  }

  async function bootstrap(layoutDotNetRef) {
    layoutRef = layoutDotNetRef ?? null;
    locationHintCache = null;
    await loadClientId();
    if (!isEmbedded()) {
      // Local shell without Discord iframe
      return {
        accessToken: "dev-token",
        userId: "local-dev",
        username: "local-dev",
        globalName: "Local Dev",
        avatar: null,
      };
    }

    // Prefer bundled Embedded App SDK when present; otherwise fall back to dynamic import.
    let DiscordSDK;
    if (window.DiscordEmbeddedAppSdk && window.DiscordEmbeddedAppSdk.DiscordSDK) {
      DiscordSDK = window.DiscordEmbeddedAppSdk.DiscordSDK;
    } else {
      const mod = await import("https://cdn.jsdelivr.net/npm/@discord/embedded-app-sdk@2.5.0/+esm");
      DiscordSDK = mod.DiscordSDK;
    }

    sdk = new DiscordSDK(clientId, { disableConsoleLogOverride: true });
    await sdk.ready();

    try {
      await sdk.commands.setOrientationLockState({
        lock_state: ORIENTATION_UNLOCKED,
        picture_in_picture_lock_state: ORIENTATION_LANDSCAPE,
        grid_lock_state: ORIENTATION_LANDSCAPE,
      });
    } catch (_) {}

    try {
      if (typeof sdk.subscribeToLayoutModeUpdatesCompat === "function") {
        sdk.subscribeToLayoutModeUpdatesCompat((u) => reportLayout(u.layout_mode));
      }
    } catch (_) {}
    try {
      sdk.subscribe(EVENT_LAYOUT, (u) => reportLayout(u.layout_mode));
    } catch (_) {}
    try {
      // Keep the PIP surface alive so last-hit updates still arrive
      await sdk.commands.setConfig({ use_interactive_pip: true });
    } catch (_) {}

    const { code } = await sdk.commands.authorize({
      client_id: clientId,
      response_type: "code",
      state: "",
      prompt: "none",
      scope: ["identify", "guilds", "guilds.members.read", "rpc.activities.write"],
    });

    const tokenRes = await fetch(`${apiBase()}/auth/discord`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (!tokenRes.ok) {
      throw new Error(`Discord auth failed: ${tokenRes.status}`);
    }
    const tokenJson = await tokenRes.json();
    if (!tokenJson.access_token) {
      throw new Error("Discord auth response did not include access_token");
    }
    try {
      await sdk.commands.authenticate({ access_token: tokenJson.access_token });
    } catch (err) {
      // OAuth already succeeded. A failed RPC authenticate must not block the activity shell.
      console.warn("Discord authenticate failed", err);
    }
    return {
      accessToken: tokenJson.access_token,
      userId: tokenJson.user?.id ?? "",
      username: tokenJson.user?.username ?? "",
      globalName: tokenJson.user?.global_name ?? null,
      avatar: tokenJson.user?.avatar ?? null,
    };
  }

  async function openExternal(url) {
    if (sdk?.commands?.openExternalLink) {
      try {
        await sdk.commands.openExternalLink({ url });
        return;
      } catch (_) {
        // fall through
      }
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function getInstanceId() {
    try {
      return sdk?.instanceId ?? null;
    } catch {
      return null;
    }
  }

  /** Raw participant rows from the Embedded App SDK (empty outside Discord). */
  async function getParticipants() {
    if (!isEmbedded() || !sdk) return [];
    const result = await sdk.commands.getInstanceConnectedParticipants();
    return result?.participants ?? [];
  }

  function subscribeParticipants(ref) {
    unsubscribeParticipants();
    if (!isEmbedded() || !sdk) return;
    participantsHandler = (data) => {
      try {
        ref.invokeMethodAsync("OnParticipantsUpdate", JSON.stringify(data?.participants ?? []));
      } catch (_) {}
    };
    try {
      sdk.subscribe(EVENT_PARTICIPANTS, participantsHandler);
    } catch (_) {
      participantsHandler = null;
    }
  }

  function unsubscribeParticipants() {
    if (!participantsHandler) return;
    try {
      sdk?.unsubscribe(EVENT_PARTICIPANTS, participantsHandler);
    } catch (_) {}
    participantsHandler = null;
  }

  function guildIconUrl(guildId, icon) {
    if (!icon) return null;
    const ext = String(icon).startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/icons/${guildId}/${icon}.${ext}?size=64`;
  }

  /** Guild / DM name + icon for the current activity (attached to operate calls for the public log). */
  async function resolveLocationHint(accessToken) {
    if (!isEmbedded() || !accessToken || accessToken === "dev-token" || !sdk) return null;
    try {
      const guildId = sdk.guildId ? String(sdk.guildId) : null;
      const channelId = sdk.channelId ? String(sdk.channelId) : null;
      const key = `${guildId ?? ""}:${channelId ?? ""}`;
      if (locationHintCache && locationHintCache.key === key && Date.now() - locationHintCache.at < LOCATION_HINT_TTL_MS) {
        return locationHintCache.value;
      }

      let locationName = null;
      let locationIconUrl = null;
      let locationKind = guildId ? "gc" : channelId ? "dm" : null;

      if (guildId) {
        const res = await fetch("https://discord.com/api/users/@me/guilds", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (res.ok) {
          const guilds = await res.json();
          const guild = Array.isArray(guilds) ? guilds.find((g) => String(g.id) === guildId) : null;
          if (guild) {
            locationName = guild.name ? String(guild.name) : null;
            locationIconUrl = guildIconUrl(guildId, guild.icon);
          }
        }
      }

      if (channelId && guildId) {
        try {
          const channel = await sdk.commands.getChannel({ channel_id: channelId });
          if (!locationName && channel?.name) locationName = String(channel.name);
        } catch (_) {}
      } else if (channelId && !guildId) {
        locationKind = "dm";
        try {
          const channel = await sdk.commands.getChannel({ channel_id: channelId });
          const name = channel?.name ? String(channel.name).trim() : "";
          if (name) locationName = name;
          else if (channel?.type === 3) locationName = "Group DM";
          else locationName = "Direct Message";
        } catch (_) {
          locationName = locationName ?? "Direct Message";
        }
      }

      if (!locationName && guildId) locationName = "Discord Server";

      const value = { guildId, channelId, locationKind, locationName, locationIconUrl };
      locationHintCache = { key, at: Date.now(), value };
      return value;
    } catch (_) {
      return null;
    }
  }

  /** Narrow viewport / short iframe → collapse the mode dock like the React client. */
  function isCompactViewport() {
    try {
      return window.matchMedia("(max-width: 720px), (max-height: 640px)").matches;
    } catch {
      return false;
    }
  }

  return {
    bootstrap,
    openExternal,
    getInstanceId,
    isEmbedded,
    getParticipants,
    subscribeParticipants,
    unsubscribeParticipants,
    resolveLocationHint,
    isCompactViewport,
  };
})();
