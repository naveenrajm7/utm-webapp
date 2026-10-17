import { timingSafeEqual } from "crypto";
import type { IncomingMessage } from "http";
import type { NextFunction, Request, Response } from "express";
import { log } from "@repo/logger";

export const getConfiguredApiKey = (): string | undefined => {
  const key = process.env.UTM_API_KEY?.trim();
  return key ? key : undefined;
};

export const assertApiKeyConfigured = (): void => {
  if (!getConfiguredApiKey()) {
    log("UTM_API_KEY is not set; refusing to start");
    process.exit(1);
  }
};

const keysMatch = (expected: string, presented: string | undefined): boolean => {
  if (!presented) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected);
  const presentedBuffer = Buffer.from(presented);

  if (expectedBuffer.length !== presentedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, presentedBuffer);
};

export const presentedKeyFromHeaders = (
  headers: IncomingMessage["headers"],
): string | undefined => {
  const authorization = headers.authorization;
  if (typeof authorization === "string") {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  const apiKeyHeader = headers["x-api-key"];
  if (typeof apiKeyHeader === "string" && apiKeyHeader.trim()) {
    return apiKeyHeader.trim();
  }

  return undefined;
};

export const presentedKeyFromRequest = (
  req: IncomingMessage,
  _url?: URL,
): string | undefined => {
  const fromHeaders = presentedKeyFromHeaders(req.headers);
  if (fromHeaders) {
    return fromHeaders;
  }

  // Browser WebSocket cannot set Authorization. The key is offered as an
  // encoded handshake subprotocol so it never appears in the request URL.
  const offeredProtocols = req.headers["sec-websocket-protocol"];
  if (typeof offeredProtocols === "string") {
    const auth = offeredProtocols.split(",").map(value => value.trim())
      .find(value => value.startsWith("utm-auth."));
    if (auth) {
      try {
        const encoded = auth.slice("utm-auth.".length).replace(/-/g, "+").replace(/_/g, "/");
        return Buffer.from(encoded, "base64").toString("utf8");
      } catch { return undefined; }
    }
  }

  return undefined;
};

export const isAuthorizedRequest = (req: IncomingMessage, url?: URL): boolean => {
  const configured = getConfiguredApiKey();
  if (!configured) {
    return false;
  }

  return keysMatch(configured, presentedKeyFromRequest(req, url));
};

export const requireApiKey = (req: Request, res: Response, next: NextFunction) => {
  if (!isAuthorizedRequest(req)) {
    return res.status(401).json({ error: "unauthorized" });
  }

  return next();
};
