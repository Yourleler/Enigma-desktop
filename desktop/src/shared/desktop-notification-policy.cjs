function normalizeDesktopNotificationOptions(rawOptions) {
  const source = rawOptions && typeof rawOptions === "object" && !Array.isArray(rawOptions) ? rawOptions : {};
  const text = value => typeof value === 'string' && value.trim() && value.length <= 8192 && !/[\u0000-\u001f]/.test(value) ? value.trim() : undefined;
  const target = source.target && typeof source.target === 'object' ? source.target : {};
  const connectionKey = text(target.connectionKey), sessionPath = text(target.sessionPath);
  const activityId = text(target.activityId), agentId = text(target.agentId);
  return {
    desktopFocusPolicy: source.desktopFocusPolicy === "when_unfocused" ? "when_unfocused" : "always",
    ...(connectionKey && (sessionPath || activityId && agentId) ? { target: {
      connectionKey,
      ...(sessionPath ? { sessionPath } : {}),
      ...(activityId && agentId ? { activityId, agentId } : {}),
    } } : {}),
  };
}

function shouldSuppressDesktopNotification(rawOptions, deps = {}) {
  const options = normalizeDesktopNotificationOptions(rawOptions);
  if (options.desktopFocusPolicy !== "when_unfocused") return false;
  const focusedWindow = deps.getFocusedWindow?.() || null;
  return !!focusedWindow && focusedWindow.isDestroyed?.() !== true;
}

module.exports = {
  normalizeDesktopNotificationOptions,
  shouldSuppressDesktopNotification,
};
