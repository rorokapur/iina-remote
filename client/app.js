let ws = null;
let reconnectTimer = null;
let currentWSURL = '';
let shouldAutoReconnect = false;

const RECONNECT_MS = 2000;
const SKIP_COOLDOWN_MS = 180;
const PLAYLIST_SELECT_COOLDOWN_MS = 220;
const SAVED_WS_URL_KEY = 'iinaRemote.wsUrl';

const ICON_PLAY = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
const ICON_PAUSE = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;

const statusText = document.getElementById('connection-status');
const statusDot = document.getElementById('connection-dot');
const statusPill = document.getElementById('status-pill');
const openConnectionBtn = document.getElementById('btn-status-open');
const connectionModal = document.getElementById('connection-modal');
const closeConnectionBtn = document.getElementById('btn-close-connection');
const titleEl = document.getElementById('media-title');
const artistEl = document.getElementById('media-artist');
const wsURLInput = document.getElementById('ws-url-input');
const connectBtn = document.getElementById('btn-connect');
const disconnectBtn = document.getElementById('btn-disconnect');
const playPauseBtn = document.getElementById('btn-play-pause');
const playPauseIcon = document.getElementById('icon-play-pause');
const previousBtn = document.getElementById('btn-previous');
const nextBtn = document.getElementById('btn-next');
const progressSlider = document.getElementById('progress-slider');
const progressFill = document.getElementById('progress-fill');
const volumeSlider = document.getElementById('volume-slider');
const volumeFill = document.getElementById('volume-fill');
const timeCurrent = document.getElementById('time-current');
const timeTotal = document.getElementById('time-total');
const stopAfterCurrentToggle = document.getElementById('stop-after-current-toggle');
const playlistListEl = document.getElementById('playlist-list');
const refreshPlaylistBtn = document.getElementById('btn-refresh-playlist');

let duration = 0;
let isSeeking = false;
let isVolumeChanging = false;
let playlist = [];
let playlistIndex = -1;
let playlistSignature = '';
let stopAfterCurrent = false;
let lastSkipAt = 0;
let lastPlaylistSelectAt = 0;

function setConnectionModalOpen(isOpen) {
  connectionModal.classList.toggle('open', isOpen);
}

function defaultWSURL() {
  const host = window.location.hostname || 'localhost';
  return `ws://${host}:48381`;
}

function normalizeWSURL(raw) {
  if (!raw) return '';
  let value = raw.trim();
  if (!value) return '';
  if (!value.startsWith('ws://') && !value.startsWith('wss://')) {
    value = `ws://${value}`;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') return '';
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function scheduleReconnect() {
  if (reconnectTimer || !shouldAutoReconnect) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(currentWSURL);
  }, RECONNECT_MS);
}

function setConnectedUI(isConnected) {
  statusText.textContent = isConnected ? 'Connected' : 'Disconnected';
  statusDot.classList.toggle('connected', isConnected);
  statusPill.classList.toggle('connected', isConnected);
  connectBtn.disabled = isConnected;
  disconnectBtn.disabled = !isConnected;
  if (isConnected) {
    setConnectionModalOpen(false);
  }
}

function setConnectingUI() {
  statusText.textContent = 'Connecting...';
  statusDot.classList.remove('connected');
  statusPill.classList.remove('connected');
  connectBtn.disabled = true;
  disconnectBtn.disabled = false;
}

function closeSocket() {
  if (!ws) return;
  try {
    ws.close();
  } catch {}
  ws = null;
}

function connect(rawURL) {
  const normalized = normalizeWSURL(rawURL || wsURLInput.value);
  if (!normalized) {
    statusText.textContent = 'Invalid URL';
    statusDot.classList.remove('connected');
    statusPill.classList.remove('connected');
    return;
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  closeSocket();
  currentWSURL = normalized;
  if (document.activeElement !== wsURLInput) {
    wsURLInput.value = normalized;
  }
  localStorage.setItem(SAVED_WS_URL_KEY, normalized);
  shouldAutoReconnect = true;
  setConnectingUI();

  ws = new WebSocket(normalized);
  const socketRef = ws;

  socketRef.onopen = () => {
    if (ws !== socketRef) return;
    setConnectedUI(true);
    sendCommand('getState');
    sendCommand('getPlaylist');
  };

  socketRef.onclose = () => {
    if (ws !== socketRef) return;
    setConnectedUI(false);
    scheduleReconnect();
  };

  socketRef.onerror = () => {
    if (ws !== socketRef) return;
    setConnectedUI(false);
  };

  socketRef.onmessage = async (event) => {
    if (ws !== socketRef) return;
    try {
      let payload = event.data;
      if (payload instanceof Blob) {
        payload = await payload.text();
      } else if (payload instanceof ArrayBuffer) {
        payload = new TextDecoder().decode(payload);
      }
      const state = JSON.parse(payload);
      applyState(state);
    } catch (e) {
      console.error('Invalid state payload', e);
    }
  };
}

function disconnect() {
  shouldAutoReconnect = false;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  closeSocket();
  setConnectedUI(false);
}

function sendCommand(command, value = null) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ command, value }));
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function playlistHash(items) {
  return items
    .map((item) => `${item.index}:${item.isPlaying ? 1 : 0}:${item.title || ''}`)
    .join('|');
}

function normalizePlaylist(items) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && typeof item === 'object')
    .map((item, idx) => ({
      index: Number.isFinite(item.index) ? Math.floor(item.index) : idx,
      title: typeof item.title === 'string' && item.title ? item.title : `Track ${idx + 1}`,
      isPlaying: Boolean(item.isPlaying)
    }));
}

function applyState(state) {
  if (!state || typeof state !== 'object') return;

  if (typeof state.title === 'string') {
    titleEl.textContent = state.title;
    if (state.artist) {
      artistEl.textContent = state.artist;
    } else {
      artistEl.textContent = state.title === 'No Media' ? 'Waiting for playback' : 'Playing in IINA';
    }
  }

  if (typeof state.pause === 'boolean') {
    playPauseIcon.innerHTML = state.pause ? ICON_PLAY : ICON_PAUSE;
  }

  if (typeof state.duration === 'number' && Number.isFinite(state.duration) && state.duration >= 0) {
    duration = state.duration;
    progressSlider.max = duration || 100;
    timeTotal.textContent = formatTime(duration);
  }

  if (typeof state['time-pos'] === 'number' && Number.isFinite(state['time-pos']) && !isSeeking) {
    const pos = Math.max(0, state['time-pos']);
    progressSlider.value = pos;
    timeCurrent.textContent = formatTime(pos);
    progressFill.style.width = duration > 0 ? `${Math.min(100, (pos / duration) * 100)}%` : '0%';
  }

  if (typeof state.volume === 'number' && Number.isFinite(state.volume) && !isVolumeChanging) {
    volumeSlider.value = state.volume;
    volumeFill.style.width = `${Math.min(100, (state.volume / Number(volumeSlider.max)) * 100)}%`;
  }

  if (state.stopAfterCurrent !== undefined) {
    stopAfterCurrent = Boolean(state.stopAfterCurrent);
    stopAfterCurrentToggle.checked = stopAfterCurrent;
  }

  if (typeof state.playlistIndex === 'number' && Number.isFinite(state.playlistIndex)) {
    playlistIndex = Math.floor(state.playlistIndex);
  }

  if (state.playlist !== undefined) {
    const nextPlaylist = normalizePlaylist(state.playlist);
    const nextSignature = playlistHash(nextPlaylist);
    const changed = nextSignature !== playlistSignature;
    playlist = nextPlaylist;
    playlistSignature = nextSignature;
    if (changed) {
      renderPlaylist();
    } else {
      updatePlaylistActive();
    }
  } else {
    updatePlaylistActive();
  }
}

function renderPlaylist() {
  playlistListEl.innerHTML = '';

  if (!playlist.length) {
    const empty = document.createElement('li');
    empty.className = 'playlist-empty';
    empty.textContent = 'No playlist items available.';
    playlistListEl.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  playlist.forEach((item) => {
    const row = document.createElement('li');
    row.className = 'playlist-item';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'playlist-btn';
    button.dataset.index = String(item.index);

    const label = document.createElement('span');
    label.className = 'playlist-label';
    label.textContent = `${String(item.index + 1).padStart(2, '0')}  ${item.title}`;

    button.appendChild(label);
    button.addEventListener('click', () => {
      const now = Date.now();
      if (now - lastPlaylistSelectAt < PLAYLIST_SELECT_COOLDOWN_MS) return;
      lastPlaylistSelectAt = now;
      sendCommand('playPlaylistIndex', item.index);
    });

    row.appendChild(button);
    frag.appendChild(row);
  });

  playlistListEl.appendChild(frag);
  updatePlaylistActive();
}

function updatePlaylistActive() {
  const buttons = playlistListEl.querySelectorAll('.playlist-btn');
  buttons.forEach((button) => {
    const idx = Number(button.dataset.index);
    button.classList.toggle('active', Number.isFinite(idx) && idx === playlistIndex);
  });
}

playPauseBtn.addEventListener('click', () => {
  sendCommand('togglePause');
});

previousBtn.addEventListener('click', () => {
  const now = Date.now();
  if (now - lastSkipAt < SKIP_COOLDOWN_MS) return;
  lastSkipAt = now;
  sendCommand('previousTrack');
});

nextBtn.addEventListener('click', () => {
  const now = Date.now();
  if (now - lastSkipAt < SKIP_COOLDOWN_MS) return;
  lastSkipAt = now;
  sendCommand('nextTrack');
});

progressSlider.addEventListener('input', (event) => {
  isSeeking = true;
  const value = parseFloat(event.target.value);
  if (!Number.isFinite(value)) return;
  timeCurrent.textContent = formatTime(value);
  progressFill.style.width = duration > 0 ? `${Math.min(100, (value / duration) * 100)}%` : '0%';
});

progressSlider.addEventListener('change', (event) => {
  isSeeking = false;
  const value = parseFloat(event.target.value);
  if (!Number.isFinite(value)) return;
  sendCommand('seek', value);
});

volumeSlider.addEventListener('input', (event) => {
  isVolumeChanging = true;
  const value = parseFloat(event.target.value);
  if (!Number.isFinite(value)) return;
  volumeFill.style.width = `${Math.min(100, (value / Number(volumeSlider.max)) * 100)}%`;
});

volumeSlider.addEventListener('change', (event) => {
  isVolumeChanging = false;
  const value = parseFloat(event.target.value);
  if (!Number.isFinite(value)) return;
  sendCommand('setVolume', value);
});

stopAfterCurrentToggle.addEventListener('change', (event) => {
  sendCommand('setStopAfterCurrent', Boolean(event.target.checked));
});

refreshPlaylistBtn.addEventListener('click', () => {
  sendCommand('getPlaylist');
});

connectBtn.addEventListener('click', () => {
  connect(wsURLInput.value);
});

disconnectBtn.addEventListener('click', () => {
  disconnect();
});

openConnectionBtn.addEventListener('click', () => {
  setConnectionModalOpen(true);
  wsURLInput.focus();
  wsURLInput.select();
});

closeConnectionBtn.addEventListener('click', () => {
  setConnectionModalOpen(false);
});

connectionModal.addEventListener('click', (event) => {
  if (event.target === connectionModal) {
    setConnectionModalOpen(false);
  }
});

wsURLInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    connect(wsURLInput.value);
  }
});

const savedWSURL = localStorage.getItem(SAVED_WS_URL_KEY);
wsURLInput.value = normalizeWSURL(savedWSURL) || defaultWSURL();
setConnectedUI(false);
setConnectionModalOpen(true);
