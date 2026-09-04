"use client";

import { FormEvent, ReactNode, useEffect, useState } from "react";
import { API_KEY_CHANGED_EVENT, getApiKey, setApiKey } from "../apiAuth";

const ApiKeyGate = ({ children }: { children: ReactNode }) => {
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
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
      <div
        className="d-flex align-items-center justify-content-center"
        style={{ height: "100vh", backgroundColor: "#202020" }}
      >
        <form
          onSubmit={handleSubmit}
          className="p-4"
          style={{
            width: "100%",
            maxWidth: "420px",
            backgroundColor: "#2c2c2c",
            borderRadius: "12px",
            border: "1px solid #444",
          }}
        >
          <h4 className="mb-3 text-white">Unlock UTM Web</h4>
          <p className="text-secondary" style={{ fontSize: "0.9rem" }}>
            Enter the API key configured as <code>UTM_API_KEY</code> on the api
            process.
          </p>
          <input
            name="apiKey"
            type="password"
            autoComplete="off"
            className="form-control mb-3"
            placeholder="API key"
            autoFocus
          />
          <button type="submit" className="btn btn-primary w-100">
            Unlock
          </button>
        </form>
      </div>
    );
  }

  return <>{children}</>;
};

export default ApiKeyGate;
