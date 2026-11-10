window.activitySocket = (function () {
  let ws = null;
  let closed = false;
  let accessToken = null;
  let dotnetRef = null;
  let attempt = 0;
  let pingTimer = null;
  let authed = false;
  let reconnectTimer = null;

  function wsUrl() {
    const embedded = new URLSearchParams(window.location.search).has("frame_id");
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const path = embedded ? "/.proxy/api/ws" : "/api/ws";
    return `${proto}//${window.location.host}${path}`;
  }

  function sendAuth() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "auth", access_token: accessToken }));
  }

  function clearPing() {
    if (pingTimer != null) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function afterAuth() {
    authed = true;
    attempt = 0;
    // join instance if available
    const instanceId = window.discordSdk?.getInstanceId?.();
    if (instanceId) {
      ws.send(JSON.stringify({ type: "join", instanceId }));
    }
    clearPing();
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
    }, 20000);
  }

  function open() {
    if (closed) return;
    clearPing();
    authed = false;
    try {
      ws = new WebSocket(wsUrl());
    } catch (_) {
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      sendAuth();
    };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(String(ev.data));
        if (data?.type === "auth_required") {
          sendAuth();
          return;
        }
        if (data?.type === "hello_ok" && !authed) {
          afterAuth();
        }
        dotnetRef?.invokeMethodAsync("HandleEvent", String(ev.data));
      } catch (_) {}
    };
    ws.onclose = () => {
      clearPing();
      ws = null;
      scheduleReconnect();
    };
    ws.onerror = () => {
      try {
        ws?.close();
      } catch (_) {}
    };
  }

  function scheduleReconnect() {
    if (closed) return;
    const delay = Math.min(15000, 800 * 2 ** attempt);
    attempt += 1;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(open, delay);
  }

  function connect(token, ref) {
    // Re-connecting replaces any previous socket
    close();
    closed = false;
    accessToken = token;
    dotnetRef = ref;
    attempt = 0;
    open();
  }

  function close() {
    closed = true;
    clearTimeout(reconnectTimer);
    clearPing();
    if (ws) {
      // Detach so a stale close event can't clobber a newer socket or schedule a reconnect
      ws.onclose = null;
      ws.onmessage = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch (_) {}
    }
    ws = null;
  }

  /**
   * Browser fetch for /api/health (and /.proxy when embedded).
   * Blazor's HttpClient has been unreliable for this poll in Discord/WASM, so the
   * AppHealthService calls this directly via JS interop.
   */
  async function fetchHealth() {
    const embedded = new URLSearchParams(window.location.search).has("frame_id");
    const base = embedded ? "/.proxy/api" : "/api";
    const res = await fetch(`${base}/health?_=${Date.now()}`, { cache: "no-store" });
    const text = await res.text();
    if (!text || text.trimStart().startsWith("<")) {
      return { ok: false, shuttingDown: false, status: res.status };
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, shuttingDown: false, status: res.status };
    }
    if (!res.ok) {
      return { ...body, ok: false, status: res.status };
    }
    return body;
  }

  return { connect, close, fetchHealth };
})();
