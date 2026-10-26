export const shutdownController = new AbortController();
export const requestSignal = (timeoutMs) =>
  AbortSignal.any([shutdownController.signal, AbortSignal.timeout(timeoutMs)]);
export function createTaskTracker() {
  const active = new Set();
  return {
    run(task) {
      let work;
      try {
        work = Promise.resolve(task());
      } catch (error) {
        work = Promise.reject(error);
      }
      active.add(work);
      void work.finally(() => active.delete(work)).catch(() => {});
      return work;
    },
    pending: () => [...active],
  };
}
export async function drainWithin(promises, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.allSettled(promises).then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function workerHealth(runtime, now = Date.now()) {
  const state = runtime?.state || {};
  const heartbeat = runtime?.heartbeat_at
    ? new Date(runtime.heartbeat_at).getTime()
    : NaN;
  const ageMs = Number.isFinite(heartbeat)
    ? Math.max(0, now - heartbeat)
    : null;
  const stopped = ["stopped", "stopping"].includes(state.workerStatus);
  const initialized =
    !!state.startedAt ||
    state.workerStatus === "running" ||
    Number(state.cycleCount) > 0;
  return {
    status: stopped
      ? state.workerStatus
      : !initialized || ageMs == null
        ? "starting"
        : ageMs > 60000
          ? "stale"
          : "healthy",
    ageMs,
    heartbeatAt: Number.isFinite(heartbeat)
      ? new Date(heartbeat).toISOString()
      : null,
  };
}
