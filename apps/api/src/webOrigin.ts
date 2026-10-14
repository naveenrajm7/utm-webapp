/** Explicit configuration limits access to one origin; defaults cover both browser loopback names. */
export const configuredWebOrigins = (): string[] => {
  const value = process.env.UTM_WEB_ORIGIN;
  if (!value) return ["http://localhost:3000", "http://127.0.0.1:3000"];
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("UTM_WEB_ORIGIN must be a local HTTP origin");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash
  ) {
    throw new Error("UTM_WEB_ORIGIN must be a local HTTP origin");
  }
  return [url.origin];
};

export const isAllowedWebOrigin = (origin: string | undefined): boolean =>
  origin !== undefined && configuredWebOrigins().includes(origin);

export const isAllowedWebSocketOrigin = (origin: string | undefined): boolean =>
  origin === undefined || isAllowedWebOrigin(origin);

export const configuredApiHost = (): string => {
  const host = process.env.HOST || "127.0.0.1";
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("HOST must be a loopback address");
  }
  return host;
};
