const API_PORT = 3001;
const TERMINAL_PORT = 3002;

/**
 * These URLs are dialled by the browser, not the server, so "localhost" would
 * point at the viewer's own machine. Default to whichever host served the page
 * so the app works unchanged over the network.
 */
const sameHostAtPort = (port: number): string => {
  if (typeof window === "undefined") {
    return `http://localhost:${port}`;
  }

  return `${window.location.protocol}//${window.location.hostname}:${port}`;
};

export const getApiHost = (): string =>
  process.env.NEXT_PUBLIC_API_HOST || sameHostAtPort(API_PORT);

export const getTerminalHost = (): string =>
  process.env.NEXT_PUBLIC_TERMINAL_HOST || sameHostAtPort(TERMINAL_PORT);

/** The API bridges the VM's VNC display over WebSocket on the same port. */
export const getApiWebSocketHost = (): string => {
  const httpHost = getApiHost();

  return httpHost.replace(/^http(s?):\/\//, (_, secure) => (secure ? "wss://" : "ws://"));
};
