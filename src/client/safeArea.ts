/** Matches the compact remote / phone layout breakpoints. */
const PHONE_MQ = '(max-width: 720px), (max-height: 740px)';

function isDiscordEmbed() {
  return new URLSearchParams(window.location.search).has('frame_id');
}

/**
 * Discord sometimes leaves `--discord-safe-area-inset-*` empty until a layout
 * or orientation change. On phone embeds, fall back to 48px top (the activity
 * Leave / Invite / minimize bar) until Discord publishes a real value.
 */
export function applyDiscordSafeAreaFallback() {
  const root = document.documentElement;
  if (!isDiscordEmbed()) {
    root.style.removeProperty('--ps-safe-area-fallback-top');
    return;
  }

  const discordTop = getComputedStyle(root)
    .getPropertyValue('--discord-safe-area-inset-top')
    .trim();
  const phoneSized = window.matchMedia(PHONE_MQ).matches;

  if (phoneSized && !discordTop) {
    root.style.setProperty('--ps-safe-area-fallback-top', '48px');
  } else {
    root.style.removeProperty('--ps-safe-area-fallback-top');
  }
}

/** Install listeners; safe to call more than once. */
export function installDiscordSafeAreaFallback() {
  applyDiscordSafeAreaFallback();

  const mq = window.matchMedia(PHONE_MQ);
  const onChange = () => applyDiscordSafeAreaFallback();

  mq.addEventListener('change', onChange);
  window.addEventListener('resize', onChange);
  window.addEventListener('orientationchange', onChange);

  return () => {
    mq.removeEventListener('change', onChange);
    window.removeEventListener('resize', onChange);
    window.removeEventListener('orientationchange', onChange);
  };
}
