/** Read-only power signals. This never changes sleep policy or pauses agent work. */
function createVisualActivityMonitor(powerMonitor, onChange, {probeSession} = {}) {
  const read = () => { try { return powerMonitor.getSystemIdleState(1); } catch { return 'unknown'; } };
  let locked = read() === 'locked', sleeping = false, revision = 0, generation = 0, disposed = false;
  const state = () => ({ suspended: locked || sleeping, reason: sleeping ? 'sleep' : locked ? 'locked' : 'active', revision });
  const emit = (update) => {
    const before = state(); update();
    if (before.suspended !== state().suspended || before.reason !== state().reason) { revision++; onChange(state()); }
  };
  const probe = () => {
    if (!probeSession) return;
    const epoch = generation;
    Promise.resolve().then(probeSession).then(value => {
      if (!disposed && epoch === generation && typeof value?.suspended === 'boolean') emit(() => { locked = value.suspended; });
    }).catch(() => {});
  };
  const listeners = {
    'lock-screen': () => { generation++; emit(() => { locked = true; }); },
    'unlock-screen': () => { generation++; emit(() => { locked = false; }); },
    suspend: () => { generation++; emit(() => { sleeping = true; }); },
    resume: () => { generation++; emit(() => { sleeping = false; const current = read(); if (current === 'locked' || !probeSession && current !== 'unknown') locked = current === 'locked'; }); probe(); },
  };
  for (const [name, listener] of Object.entries(listeners)) powerMonitor.on(name, listener);
  probe();
  return { getState: state, dispose() { disposed = true; generation++; for (const [name, listener] of Object.entries(listeners)) powerMonitor.removeListener(name, listener); } };
}
module.exports = { createVisualActivityMonitor };
