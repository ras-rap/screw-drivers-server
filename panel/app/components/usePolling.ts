"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { panelFetch } from "@/lib/client";

/**
 * Polls a panel endpoint and returns the last good payload plus the latest error, so a
 * view keeps showing data while the server is briefly unreachable.
 */
export function usePolling<T>(path: string, intervalMs = 4000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const next = await panelFetch<T>(path);
      if (!alive.current) return;
      setData(next);
      setError(null);
    } catch (problem) {
      if (!alive.current) return;
      setError(problem instanceof Error ? problem.message : String(problem));
    }
  }, [path]);

  useEffect(() => {
    alive.current = true;
    void reload();
    const timer = setInterval(() => void reload(), intervalMs);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [reload, intervalMs]);

  return { data, error, reload };
}
