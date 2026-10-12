import { act, renderHook, waitFor, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTaskBoard } from "./useTaskBoard";
import { previewBridge } from "./bridge";
import type { Snapshot } from "./types";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("remote-authoritative task state", () => {
  it("drops another account's visible tasks after a failed refresh and identity change", async () => {
    const api = previewBridge();
    const first = await api.snapshot();
    const { result } = renderHook(() => useTaskBoard(api));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.snapshot?.tasks.length).toBeGreaterThan(0);
    api.refresh = vi.fn(async () => {
      throw { kind: "network", message: "offline" };
    });
    api.snapshot = vi.fn(async () => ({
      ...first,
      auth: { ...first.auth, userId: "other-user", userName: "另一个账号" },
      tasks: [],
      lastSyncedAt: null,
    }));
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.snapshot?.auth.userId).toBe("other-user");
    expect(result.current.snapshot?.tasks).toEqual([]);
  });
  it("backs off failed synchronization and keeps cache until recovery", async () => {
    vi.useFakeTimers();
    const api = previewBridge();
    const normalRefresh = api.refresh;
    const spy = vi.fn(normalRefresh);
    api.refresh = spy;
    const { result } = renderHook(() => useTaskBoard(api));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    spy.mockRejectedValueOnce({ kind: "network", message: "offline" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    const afterFailure = spy.mock.calls.length;
    expect(result.current.error).toBe("offline");
    expect(result.current.snapshot?.tasks.length).toBeGreaterThan(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
      window.dispatchEvent(new Event("focus"));
    });
    expect(spy.mock.calls.length).toBe(afterFailure);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000);
    });
    expect(spy.mock.calls.length).toBe(afterFailure + 1);
    expect(result.current.error).toBe(null);
  });
  it("keeps task pending until remote completion resolves", async () => {
    const api = previewBridge();
    const state = await api.snapshot();
    const guid = state.tasks[0].guid;
    let resolve!: (value: Snapshot) => void;
    api.complete = vi.fn(
      () =>
        new Promise<Snapshot>((done) => {
          resolve = done;
        }),
    );
    const { result } = renderHook(() => useTaskBoard(api));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let request!: Promise<boolean>;
    act(() => {
      request = result.current.complete(guid);
    });
    expect(result.current.submitting).toBe(guid);
    expect(result.current.snapshot?.tasks.some((t) => t.guid === guid)).toBe(
      true,
    );
    await act(async () => {
      resolve({ ...state, tasks: state.tasks.filter((t) => t.guid !== guid) });
      await request;
    });
    expect(result.current.snapshot?.tasks.some((t) => t.guid === guid)).toBe(
      false,
    );
    expect(result.current.submitting).toBe(null);
  });
  it("retains pending state and records uncertain result after lost readback", async () => {
    const api = previewBridge();
    const state = await api.snapshot();
    const guid = state.tasks[0].guid;
    api.complete = vi.fn(async () => {
      throw { kind: "uncertain", message: "结果待确认" };
    });
    const { result } = renderHook(() => useTaskBoard(api));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.complete(guid);
    });
    expect(result.current.snapshot?.tasks.some((t) => t.guid === guid)).toBe(
      true,
    );
    expect(result.current.uncertain.has(guid)).toBe(true);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.uncertain.has(guid)).toBe(false);
  });
  it("serializes refresh with completion and does not submit duplicate writes", async () => {
    const api = previewBridge();
    const state = await api.snapshot();
    const guid = state.tasks[0].guid;
    let resolve!: (value: Snapshot) => void;
    api.complete = vi.fn(
      () =>
        new Promise<Snapshot>((done) => {
          resolve = done;
        }),
    );
    api.refresh = vi.fn(api.refresh);
    const { result } = renderHook(() => useTaskBoard(api));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const before = vi.mocked(api.refresh).mock.calls.length;
    let request!: Promise<boolean>;
    act(() => {
      request = result.current.complete(guid);
    });
    await act(async () => {
      await result.current.refresh();
      await result.current.complete(guid);
    });
    expect(api.complete).toHaveBeenCalledTimes(1);
    expect(api.refresh).toHaveBeenCalledTimes(before);
    await act(async () => {
      resolve(state);
      await request;
    });
  });
  it("refreshes every two minutes after the preference changes", async () => {
    vi.useFakeTimers();
    const api = previewBridge();
    api.refresh = vi.fn(api.refresh);
    const { result } = renderHook(() => useTaskBoard(api));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await result.current.preferences({
        intervalSeconds: 120,
        alwaysOnTop: false,
      });
    });
    const before = vi.mocked(api.refresh).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
    });
    expect(api.refresh).toHaveBeenCalledTimes(before + 1);
  });
  it("ignores frequent focus changes but refreshes after the interval elapses", async () => {
    vi.useFakeTimers();
    const api = previewBridge();
    api.refresh = vi.fn(api.refresh);
    renderHook(() => useTaskBoard(api));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const before = vi.mocked(api.refresh).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
      window.dispatchEvent(new Event("focus"));
    });
    expect(api.refresh).toHaveBeenCalledTimes(before);
    await act(async () => {
      vi.setSystemTime(Date.now() + 300_000);
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
    });
    expect(api.refresh).toHaveBeenCalledTimes(before + 1);
  });
  it("does not send a scheduled request shortly after a manual refresh", async () => {
    vi.useFakeTimers();
    const api = previewBridge();
    api.refresh = vi.fn(api.refresh);
    const { result } = renderHook(() => useTaskBoard(api));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(240_000);
      await result.current.refresh();
    });
    const afterManual = vi.mocked(api.refresh).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(api.refresh).toHaveBeenCalledTimes(afterManual);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(240_000);
    });
    expect(api.refresh).toHaveBeenCalledTimes(afterManual + 1);
  });
});
