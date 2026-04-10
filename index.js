const MAX_PLAYLIST_ITEMS = 400;
const STATE_FLUSH_MS = 80;
const TIME_POS_MIN_INTERVAL_MS = 450;

function initPlayer() {
  let stopAfterCurrent = false;
  let pauseOnNextFileLoaded = false;
  let lastTimePos = -1;
  let lastTimePosAt = 0;

  let pendingState = {};
  let flushTimer = null;

  function reportError(scope, error) {
    iina.console.error(`[player:${scope}] ${String(error)}`);
  }

  function safeNumber(name, fallback) {
    try {
      const value = iina.mpv.getNumber(name);
      return Number.isFinite(value) ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function safeBoolean(name, fallback) {
    try {
      return Boolean(iina.mpv.getNative(name));
    } catch {
      return fallback;
    }
  }

  function safeString(name, fallback) {
    try {
      const value = iina.mpv.getString(name);
      return value || fallback;
    } catch {
      return fallback;
    }
  }

  function queueState(partial) {
    if (!partial || typeof partial !== "object") return;
    pendingState = { ...pendingState, ...partial };
    if (flushTimer) return;

    flushTimer = setTimeout(() => {
      const payload = pendingState;
      pendingState = {};
      flushTimer = null;
      try {
        iina.global.postMessage("remote-state", payload);
      } catch (e) {
        reportError("post-state", e);
      }
    }, STATE_FLUSH_MS);
  }

  function displayNameFromPath(value) {
    if (!value) return "Untitled";
    const trimmed = value.split("?")[0];
    const pieces = trimmed.split(/[\\/]/).filter(Boolean);
    const tail = pieces.length ? pieces[pieces.length - 1] : trimmed;
    if (!tail) return "Untitled";
    try {
      return decodeURIComponent(tail);
    } catch {
      return tail;
    }
  }

  function getPlaylistState() {
    try {
      const list = iina.playlist.list().slice(0, MAX_PLAYLIST_ITEMS);
      const playlist = list.map((item, index) => ({
        index,
        title: item.title || displayNameFromPath(item.filename),
        isPlaying: Boolean(item.isPlaying || item.isCurrent)
      }));
      const current = playlist.find((item) => item.isPlaying);
      return {
        playlist,
        playlistIndex: current ? current.index : -1
      };
    } catch (e) {
      reportError("playlist-state", e);
      return { playlist: [], playlistIndex: -1 };
    }
  }

  function safeMetadata(name, fallback) {
    try {
      const meta = iina.mpv.getNative("metadata");
      if (!meta || typeof meta !== "object") return fallback;
      return meta[name] || meta[name.toLowerCase()] || fallback;
    } catch {
      return fallback;
    }
  }

  function fullState() {
    return {
      pause: safeBoolean("pause", true),
      volume: safeNumber("volume", 100),
      "time-pos": safeNumber("time-pos", 0),
      duration: safeNumber("duration", 0),
      title: safeString("media-title", "No Media"),
      artist: safeMetadata("Artist", ""),
      stopAfterCurrent,
      ...getPlaylistState()
    };
  }

  function emitFullState() {
    queueState(fullState());
  }

  function withGuard(scope, fn) {
    try {
      fn();
    } catch (e) {
      reportError(scope, e);
    }
  }

  iina.event.on("mpv.pause.changed", () =>
    withGuard("pause.changed", () => {
      queueState({ pause: safeBoolean("pause", true) });
    })
  );

  iina.event.on("mpv.volume.changed", () =>
    withGuard("volume.changed", () => {
      queueState({ volume: safeNumber("volume", 100) });
    })
  );

  iina.event.on("mpv.duration.changed", () =>
    withGuard("duration.changed", () => {
      queueState({ duration: safeNumber("duration", 0) });
    })
  );

  iina.event.on("mpv.media-title.changed", () =>
    withGuard("title.changed", () => {
      queueState({ title: safeString("media-title", "No Media") });
    })
  );

  iina.event.on("mpv.time-pos.changed", () =>
    withGuard("time-pos.changed", () => {
      const pos = safeNumber("time-pos", 0);
      const now = Date.now();
      if (now - lastTimePosAt < TIME_POS_MIN_INTERVAL_MS && Math.abs(pos - lastTimePos) < 0.75) {
        return;
      }
      lastTimePos = pos;
      lastTimePosAt = now;
      queueState({ "time-pos": pos });
    })
  );

  iina.event.on("mpv.playlist-pos.changed", () =>
    withGuard("playlist-pos.changed", () => {
      queueState(getPlaylistState());
    })
  );

  iina.event.on("mpv.playlist-count.changed", () =>
    withGuard("playlist-count.changed", () => {
      queueState(getPlaylistState());
    })
  );

  iina.event.on("mpv.end-file", () =>
    withGuard("end-file", () => {
      if (stopAfterCurrent) {
        pauseOnNextFileLoaded = true;
      }
    })
  );

  iina.event.on("iina.file-loaded", () =>
    withGuard("file-loaded", () => {
      if (pauseOnNextFileLoaded) {
        pauseOnNextFileLoaded = false;
        iina.core.pause();
      }
      emitFullState();
    })
  );

  function handleRemoteCommand(raw) {
    if (!raw || typeof raw !== "object") return;
    const command = raw.command;
    const value = raw.value;

    switch (command) {
      case "pause":
        iina.core.pause();
        queueState({ pause: true });
        return;
      case "resume":
        iina.core.resume();
        queueState({ pause: false });
        return;
      case "togglePause":
        if (safeBoolean("pause", true)) {
          iina.core.resume();
          queueState({ pause: false });
        } else {
          iina.core.pause();
          queueState({ pause: true });
        }
        return;
      case "previousTrack":
        pauseOnNextFileLoaded = false;
        if (safeNumber("time-pos", 0) > 3) {
          iina.core.seekTo(0);
          queueState({ "time-pos": 0 });
        } else {
          iina.playlist.playPrevious();
        }
        return;
      case "nextTrack":
        pauseOnNextFileLoaded = false;
        iina.playlist.playNext();
        return;
      case "setVolume":
        if (typeof value !== "number" || !Number.isFinite(value)) return;
        iina.core.audio.volume = Math.max(0, Math.min(value, 100));
        queueState({ volume: safeNumber("volume", 100) });
        return;
      case "seek":
        if (typeof value !== "number" || !Number.isFinite(value)) return;
        {
          const duration = safeNumber("duration", 0);
          const seekTarget = duration > 0 ? Math.min(Math.max(value, 0), duration) : Math.max(value, 0);
          iina.core.seekTo(seekTarget);
          queueState({ "time-pos": safeNumber("time-pos", seekTarget) });
        }
        return;
      case "playPlaylistIndex":
        if (typeof value !== "number" || !Number.isFinite(value)) return;
        {
          pauseOnNextFileLoaded = false;
          const index = Math.floor(value);
          const count = iina.playlist.count();
          if (index >= 0 && index < count) {
            iina.playlist.play(index);
          }
        }
        return;
      case "setStopAfterCurrent":
        stopAfterCurrent = Boolean(value);
        if (!stopAfterCurrent) {
          pauseOnNextFileLoaded = false;
        }
        queueState({ stopAfterCurrent });
        return;
      case "getPlaylist":
        queueState(getPlaylistState());
        return;
      case "getState":
        emitFullState();
        return;
      default:
        return;
    }
  }

  iina.global.onMessage("remote-command", (message) =>
    withGuard("remote-command", () => {
      handleRemoteCommand(message);
    })
  );

  emitFullState();
}

initPlayer();
