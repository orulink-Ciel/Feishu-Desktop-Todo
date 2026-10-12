import { useCallback, useEffect, useRef, useState } from "react";
import type { Bridge, Preferences, Snapshot } from "./types";
import { errorMessage, retryDelay } from "./tasks";
export function useTaskBoard(api: Bridge) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  const failures = useRef(0);
  const lastAttempt = useRef(0);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const apply = useCallback((next: Snapshot) => {
    if (alive.current) {
      snapshotRef.current = next;
      setSnapshot(next);
    }
  }, []);
  const recoverIdentity = useCallback(async () => {
    try {
      apply(await api.snapshot());
    } catch {
      if (alive.current) setSnapshot(null);
    }
  }, [api, apply]);
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    lastAttempt.current = Date.now();
    setWorking(true);
    try {
      apply(await api.refresh());
      failures.current = 0;
      setError(null);
      setUncertain(new Set());
    } catch (failure) {
      failures.current += 1;
      setError(errorMessage(failure).message);
      await recoverIdentity();
    } finally {
      busy.current = false;
      if (alive.current) setWorking(false);
    }
  }, [api, apply, recoverIdentity]);
  useEffect(() => {
    alive.current = true;
    void (async () => {
      try {
        const current = await api.snapshot();
        apply(current);
        if (current.auth.canRead && alive.current) await refresh();
      } catch (failure) {
        if (alive.current) setError(errorMessage(failure).message);
      } finally {
        if (alive.current) setLoading(false);
      }
    })();
    return () => {
      alive.current = false;
    };
  }, [api, apply, refresh]);
  useEffect(() => {
    if (!snapshot?.auth.canRead) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const remainingDelay = () => {
      const interval = snapshotRef.current?.preferences.intervalSeconds ?? 300;
      return (
        retryDelay(failures.current, interval) -
        (Date.now() - lastAttempt.current)
      );
    };
    const schedule = () => {
      timer = setTimeout(
        async () => {
          if (!alive.current || cancelled) return;
          if (snapshotRef.current?.auth.canRead && remainingDelay() <= 0)
            await refresh();
          if (alive.current && !cancelled) schedule();
        },
        Math.max(250, remainingDelay()),
      );
    };
    schedule();
    const onFocus = () => {
      if (remainingDelay() <= 0 && snapshotRef.current?.auth.canRead)
        void refresh();
    };
    window.addEventListener("focus", onFocus);
    const onVisible = () => {
      if (document.visibilityState === "visible") onFocus();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [snapshot?.auth.canRead, snapshot?.preferences.intervalSeconds, refresh]);
  const mutation = useCallback(
    async (
      action: () => Promise<Snapshot>,
      guid?: string,
      successMessage?: string,
    ) => {
      if (busy.current) return false;
      busy.current = true;
      setWorking(true);
      if (guid) setSubmitting(guid);
      try {
        apply(await action());
        setError(null);
        if (successMessage) setNotice(successMessage);
        if (guid)
          setUncertain((current) => {
            const next = new Set(current);
            next.delete(guid);
            return next;
          });
        return true;
      } catch (failure) {
        const problem = errorMessage(failure);
        setError(problem.message);
        if (guid && problem.kind === "uncertain")
          setUncertain((current) => new Set(current).add(guid));
        await recoverIdentity();
        return false;
      } finally {
        busy.current = false;
        if (alive.current) {
          setWorking(false);
          setSubmitting(null);
        }
      }
    },
    [apply, recoverIdentity],
  );
  const complete = useCallback(
    (guid: string, confirmWhole = false) =>
      mutation(
        () => api.complete(guid, confirmWhole),
        guid,
        api.preview ? "示例任务已完成" : "飞书已确认完成",
      ),
    [api, mutation],
  );
  const pin = useCallback(
    (guid: string, pinned: boolean) => mutation(() => api.pin(guid, pinned)),
    [api, mutation],
  );
  const preferences = useCallback(
    (prefs: Preferences) => mutation(() => api.preferences(prefs)),
    [api, mutation],
  );
  const finishLogin = useCallback(
    (sessionId: string) =>
      mutation(() => api.finishLogin(sessionId), undefined, "已连接飞书"),
    [api, mutation],
  );
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  return {
    snapshot,
    loading,
    working,
    submitting,
    uncertain,
    error,
    notice,
    refresh,
    complete,
    pin,
    preferences,
    finishLogin,
    setError,
  };
}
