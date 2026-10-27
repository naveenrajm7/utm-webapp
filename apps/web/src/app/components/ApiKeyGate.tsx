"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";
import { API_KEY_CHANGED_EVENT, apiFetch, getApiKey, setApiKey, useApiKeyAuth, useSessionAuth } from "../apiAuth";
import { IS_DEMO } from "../demo";
import { AppIcon } from "./VMIcon";

type GateState = "loading" | "setup" | "login" | "api-key" | "ready" | "error";
const ApiKeyGate = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<GateState>(IS_DEMO ? "ready" : "loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (IS_DEMO) return;
    let active = true;
    const sync = async () => {
      try {
        const response = await apiFetch("/auth/status");
        if (!response.ok) throw new Error("Could not connect. Check that UTM Web is running and try again.");
        const status = await response.json();
        if (!active) return;
        if (status.mode === "api-key") {
          useApiKeyAuth();
          setState(getApiKey() ? "ready" : "api-key");
        } else if (status.mode === "session") {
          useSessionAuth(status.csrf);
          // Remove credentials retained by tabs from the former API-key flow.
          sessionStorage.removeItem("utm-api-key");
          setState(status.setupRequired ? "setup" : status.authenticated ? "ready" : "login");
        } else throw new Error("Unexpected authentication response.");
      } catch (cause) {
        if (active) { setError((cause as Error).message); setState("error"); }
      }
    };
    const onChanged = () => { void sync(); };
    void sync();
    window.addEventListener(API_KEY_CHANGED_EVENT, onChanged);
    // A sibling tab may have logged out while this page was in the background.
    window.addEventListener("focus", onChanged);
    return () => {
      active = false;
      window.removeEventListener(API_KEY_CHANGED_EVENT, onChanged);
      window.removeEventListener("focus", onChanged);
    };
  }, [revision]);

  if (state === "ready") return <>{children}</>;
  const setup = state === "setup";
  const legacy = state === "api-key";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    if (legacy) { setApiKey(String(data.get("apiKey") || "").trim()); return; }
    const password = String(data.get("password") || "");
    if (setup && password !== data.get("confirmPassword")) { setError("Passwords do not match."); return; }
    setBusy(true);
    try {
      const response = await apiFetch(`/auth/${setup ? "setup" : "login"}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: data.get("username"), password,
          ...(setup ? { setupCode: data.get("setupCode") } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "Could not sign in. Try again.");
      if (setup) {
        setState("login");
        setError("");
      } else {
        useSessionAuth(result.csrf);
        setState("ready");
      }
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="unlock-screen">
      <form key={state} onSubmit={submit} className="unlock-sheet">
        <AppIcon size={64} />
        <h1>{setup ? "Set up UTM Web" : legacy ? "Unlock UTM Web" : state === "loading" ? "Connecting…" : "Log in to UTM Web"}</h1>
        {setup && <p>Create the administrator account for this Mac. Enter the one-time setup code shown in the server log.</p>}
        {legacy && <p>Enter the API key configured as <code>UTM_API_KEY</code> on the API process.</p>}
        {state === "login" && <p>Use your administrator account to continue.</p>}
        {error && <p role="alert">{error}</p>}
        {state === "error" && <button type="button" className="push-button" onClick={() => { setError(""); setState("loading"); setRevision(value => value + 1); }}>Try again</button>}
        {legacy && <input name="apiKey" type="password" autoComplete="off" className="text-field" placeholder="API key" aria-label="API key" required autoFocus />}
        {(setup || state === "login") && <>
          {setup && <input name="setupCode" className="text-field" placeholder="Setup code" aria-label="Setup code" autoComplete="off" required />}
          <input name="username" className="text-field" placeholder="Username" aria-label="Username" autoComplete="username" maxLength={64} pattern="[a-zA-Z0-9][a-zA-Z0-9_.\-]{0,63}" required />
          <input name="password" type="password" className="text-field" placeholder={setup ? "Password (at least 12 characters)" : "Password"} aria-label="Password" autoComplete={setup ? "new-password" : "current-password"} minLength={setup ? 12 : undefined} maxLength={128} required />
          {setup && <input name="confirmPassword" type="password" className="text-field" placeholder="Confirm password" aria-label="Confirm password" autoComplete="new-password" minLength={12} maxLength={128} required />}
        </>}
        {["setup", "login", "api-key"].includes(state) && <button type="submit" className="push-button is-default" disabled={busy}>
          {busy ? "Please wait…" : setup ? "Create administrator" : legacy ? "Unlock" : "Log in"}
        </button>}
      </form>
    </div>
  );
};
export default ApiKeyGate;
