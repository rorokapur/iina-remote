const PORT = 3001;
const RESTART_DELAY_MS = 2500;
const MAX_PLAYLIST_ITEMS = 400;

const COMMANDS = new Set([
  "pause",
  "resume",
  "togglePause",
  "previousTrack",
  "nextTrack",
  "setVolume",
  "seek",
  "getState",
  "getPlaylist",
  "playPlaylistIndex",
  "setStopAfterCurrent"
]);

function initGlobal() {
  const connections = new Set();
  let activePlayerID = null;
  let restartTimer = null;

  let latestState = {
    pause: true,
    volume: 100,
    "time-pos": 0,
    duration: 0,
    title: "No Media",
    stopAfterCurrent: false,
    playlist: [],
    playlistIndex: -1
  };

  function reportError(scope, error) {
    iina.console.error(`[global:${scope}] ${String(error)}`);
  }

  function safeJSONStringify(value) {
    try {
      return JSON.stringify(value);
    } catch (e) {
      reportError("json-stringify", e);
      return "{}";
    }
  }

  function cleanTitle(value) {
    return typeof value === "string" && value ? value : "No Media";
  }

  function sanitizePlaylist(value) {
    if (!Array.isArray(value)) return [];
    const trimmed = value.slice(0, MAX_PLAYLIST_ITEMS);
    return trimmed
      .map((item, index) => {
        if (!item || typeof item !== "object") return null;
        const itemIndex =
          typeof item.index === "number" && Number.isFinite(item.index) ? Math.floor(item.index) : index;
        const title = typeof item.title === "string" && item.title ? item.title : `Track ${itemIndex + 1}`;
        const isPlaying = Boolean(item.isPlaying);
        return { index: itemIndex, title, isPlaying };
      })
      .filter(Boolean);
  }

  function sanitizeIncomingState(raw) {
    if (!raw || typeof raw !== "object") return null;
    const result = {};

    if (typeof raw.pause === "boolean") result.pause = raw.pause;
    if (typeof raw.volume === "number" && Number.isFinite(raw.volume)) result.volume = raw.volume;
    if (typeof raw["time-pos"] === "number" && Number.isFinite(raw["time-pos"])) result["time-pos"] = raw["time-pos"];
    if (typeof raw.duration === "number" && Number.isFinite(raw.duration)) result.duration = raw.duration;
    if (raw.title !== undefined) result.title = cleanTitle(raw.title);
    if (raw.stopAfterCurrent !== undefined) result.stopAfterCurrent = Boolean(raw.stopAfterCurrent);
    if (raw.playlist !== undefined) result.playlist = sanitizePlaylist(raw.playlist);
    if (typeof raw.playlistIndex === "number" && Number.isFinite(raw.playlistIndex)) {
      result.playlistIndex = Math.floor(raw.playlistIndex);
    }

    return result;
  }

  function samePlaylist(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!a[i] || !b[i]) return false;
      if (a[i].index !== b[i].index) return false;
      if (a[i].title !== b[i].title) return false;
      if (Boolean(a[i].isPlaying) !== Boolean(b[i].isPlaying)) return false;
    }
    return true;
  }

  function diffState(next, prev) {
    const changed = {};
    for (const key in next) {
      if (key === "playlist") {
        if (!samePlaylist(next.playlist, prev.playlist)) {
          changed.playlist = next.playlist;
        }
        continue;
      }
      if (next[key] !== prev[key]) {
        changed[key] = next[key];
      }
    }
    return changed;
  }

  function postToPlayers(command, value = null) {
    const payload = { command, value };
    if (activePlayerID) {
      try {
        iina.global.postMessage(activePlayerID, "remote-command", payload);
        return;
      } catch (e) {
        reportError("post-active-player", e);
      }
    }

    try {
      iina.global.postMessage(null, "remote-command", payload);
    } catch (e) {
      reportError("post-all-players", e);
    }
  }

  function broadcastToAll(payload) {
    const data = safeJSONStringify(payload);
    connections.forEach((conn) => {
      try {
        iina.ws.sendText(conn, data);
      } catch (e) {
        connections.delete(conn);
        reportError("send-ws", e);
      }
    });
  }

  function scheduleRestart() {
    if (restartTimer) return;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      startServer();
    }, RESTART_DELAY_MS);
  }

  function startServer() {
    try {
      const port = iina.preferences.get("port") || 3001;
      iina.ws.createServer({ port });
      iina.ws.startServer();
    } catch (e) {
      reportError("start-server", e);
      scheduleRestart();
    }
  }

  iina.ws.onStateUpdate((state, error) => {
    if (state === "failed" || state === "cancelled") {
      reportError("server-state", error?.message || state);
      scheduleRestart();
    }
  });

  iina.ws.onNewConnection((conn) => {
    connections.add(conn);
    try {
      iina.ws.sendText(conn, safeJSONStringify(latestState));
    } catch (e) {
      reportError("send-initial", e);
    }
    postToPlayers("getState");
    postToPlayers("getPlaylist");
  });

  iina.ws.onConnectionStateUpdate((conn, state) => {
    if (state === "failed" || state === "cancelled" || state === "closed") {
      connections.delete(conn);
    }
  });

  iina.ws.onMessage((conn, rawMessage) => {
    let parsed = null;
    try {
      parsed = JSON.parse(rawMessage.text());
    } catch (e) {
      reportError("parse-message", e);
      return;
    }

    if (!parsed || typeof parsed !== "object") return;
    const command = parsed.command;
    const value = parsed.value;
    if (!COMMANDS.has(command)) return;

    if (command === "getState") {
      try {
        iina.ws.sendText(conn, safeJSONStringify(latestState));
      } catch (e) {
        reportError("send-cached-state", e);
      }
      postToPlayers("getState");
      return;
    }

    if (command === "getPlaylist") {
      try {
        iina.ws.sendText(
          conn,
          safeJSONStringify({ playlist: latestState.playlist || [], playlistIndex: latestState.playlistIndex ?? -1 })
        );
      } catch (e) {
        reportError("send-cached-playlist", e);
      }
      postToPlayers("getPlaylist");
      return;
    }

    if (command === "seek" || command === "setVolume" || command === "playPlaylistIndex") {
      if (typeof value !== "number" || !Number.isFinite(value)) return;
    }

    postToPlayers(command, value ?? null);
  });

  iina.global.onMessage("remote-state", (rawState, playerID) => {
    if (playerID) {
      activePlayerID = playerID;
    }

    const sanitized = sanitizeIncomingState(rawState);
    if (!sanitized) return;

    const changed = diffState(sanitized, latestState);
    if (Object.keys(changed).length === 0) return;

    latestState = { ...latestState, ...changed };
    broadcastToAll(changed);
  });

  startServer();
}

initGlobal();
