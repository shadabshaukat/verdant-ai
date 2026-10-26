/** Reserve before the first await; release even if setup or reporting fails. */
export function exclusiveTask(task, onError = () => {}) {
  let busy = false;
  const run = (...args) => {
    if (busy) return Promise.resolve({ skipped: true });
    busy = true;
    return (async () => {
      try {
        return await task(...args);
      } catch (error) {
        try {
          await onError(error);
        } catch {
          /* Reporting cannot escape detached work. */
        }
        return { error: String(error?.message || error) };
      } finally {
        busy = false;
      }
    })();
  };
  Object.defineProperty(run, "busy", { get: () => busy });
  return run;
}
export function steeringChanged(original, current) {
  return String(original?.directive || "") !== String(current?.directive || "");
}
export function shouldEscalateExpiredAction(action, now = Date.now()) {
  return (
    action.status === "running" &&
    Number(action.attempts) >= 2 &&
    action.claimed_until != null &&
    Number.isFinite(+new Date(action.claimed_until)) &&
    +new Date(action.claimed_until) < now
  );
}
/** Independent target reads retain the reachable node's evidence during an outage. */
export async function collectReplicationEvidence(readPrimary, readStandby) {
  const [primary, standby] = await Promise.allSettled([
    Promise.resolve().then(readPrimary),
    Promise.resolve().then(readStandby),
  ]);
  return {
    primarySenders: primary.status === "fulfilled" ? primary.value : [],
    ...(primary.status === "rejected"
      ? { primaryError: String(primary.reason?.message || primary.reason) }
      : {}),
    standby:
      standby.status === "fulfilled"
        ? standby.value
        : { error: String(standby.reason?.message || standby.reason) },
    note: "NULL replay lag means no current measurement, not zero. WAL byte distance and heartbeat sequence provide separate evidence.",
  };
}
