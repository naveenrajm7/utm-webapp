"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";
import { API_KEY_CHANGED_EVENT, getApiKey, setApiKey } from "../apiAuth";
import { IS_DEMO } from "../demo";
import { AppIcon } from "./VMIcon";

const ApiKeyGate = ({ children }: { children: ReactNode }) => {
  const [unlocked, setUnlocked] = useState(IS_DEMO);

  useEffect(() => {
    if (IS_DEMO) return;
    const sync = () => setUnlocked(Boolean(getApiKey()));
    sync();
    window.addEventListener(API_KEY_CHANGED_EVENT, sync);
    return () => window.removeEventListener(API_KEY_CHANGED_EVENT, sync);
  }, []);

  if (!unlocked) {
    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(form);
      const key = String(formData.get("apiKey") || "").trim();
      if (!key) {
        return;
      }
      setApiKey(key);
    };

    return (
      <div className="unlock-screen">
        <form onSubmit={handleSubmit} className="unlock-sheet">
          <AppIcon size={64} />
          <h1>Unlock UTM Web</h1>
          <p>
            Enter the API key configured as <code>UTM_API_KEY</code> on the api
            process.
          </p>
          <input
            name="apiKey"
            type="password"
            autoComplete="off"
            className="text-field"
            placeholder="API key"
            aria-label="API key"
            autoFocus
          />
          <button type="submit" className="push-button is-default">
            Unlock
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
};

export default ApiKeyGate;
