"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { VmStore } from "./vmStore";

export const useVmList = () => {
  const [store] = useState(() => new VmStore());
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  useEffect(() => {
    void store.refresh();
    const inventoryTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void store.refresh();
    }, 5000);
    const jobTimer = window.setInterval(() => void store.pollJob(), 2000);
    return () => {
      window.clearInterval(inventoryTimer);
      window.clearInterval(jobTimer);
    };
  }, [store]);

  return {
    ...state,
    refresh: store.refresh,
    runAction: store.runAction,
    select: store.select,
    dismissActionError: store.dismissActionError,
  };
};
