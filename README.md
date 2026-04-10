# IINA Remote

A lightweight, **vibe coded** remote control for the [IINA](https://iina.io/) media player.

## How it Works

The project consists of two parts:
1.  **IINA Plugin**: A global plugin that runs a WebSocket server directly within IINA. It listens for commands (play, pause, seek, volume, etc.) and broadcasts the current player state to all connected clients.
2.  **Web Client**: A vanilla HTML/JS single-page application that connects to the IINA plugin's WebSocket server to provide a remote control interface.

> [!WARNING]
> The web client **must** be served over `http://`, not `https://`. The IINA plugin API currently only supports `ws://` (insecure) connections. Modern browsers will block these WebSocket connections if the page is loaded over HTTPS (Mixed Content blocking).

## Configuration

### Port Number
The WebSocket port is hardcoded to **`48381`** to ensure zero-configuration setup for most users.

-   **Why `48381`?** It's a high port number unlikely to be used by other applications, reducing the risk of port conflicts.
-   **Changing the Port**: If you need to change it, update the `PORT` constant in `global.js` and the `defaultWSURL` function in `client/app.js`.

## Getting Started

### 1. Install the Plugin
1.  Open **IINA > Preferences > Plugins**.
2.  Click **"Install from GitHub..."**.
3.  Enter **`rorokapur/iina-remote`** and click Install.
4.  Ensure the plugin is enabled.

### 2. Serve the Client
You can serve the web interface locally using `npx serve`:

```bash
npx serve client
```

### 3. Connect
Open the served URL in any browser on your network. Enter your Mac's IP address (or `localhost` if on the same machine) and the port `48381` in the connection dialog.
