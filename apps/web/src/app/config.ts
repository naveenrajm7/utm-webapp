/** Production REST requests stay on the origin that served the page. */
export const getApiHost = (): string =>
  process.env.NEXT_PUBLIC_API_HOST || "";

/** The API bridges the VM's serial console and VNC display over WebSocket. */
export const getApiWebSocketHost = (): string => {
  const pageOrigin = typeof window === "undefined"
    ? "http://localhost"
    : window.location.origin ||
      `${window.location.protocol}//${window.location.host || window.location.hostname}`;
  const httpHost = getApiHost() || pageOrigin;

  return httpHost.replace(/^http(s?):\/\//, (_, secure) => (secure ? "wss://" : "ws://"));
};
