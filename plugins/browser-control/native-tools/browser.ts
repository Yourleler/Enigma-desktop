// Native operations are executed by the host; the plugin owns availability,
// tool guidance and future capability configuration, retaining session policy.
// Never import a second copy of the app's runtime from a packaged plugin.
export default function browserPlugin(getSessionPath, options, host) {
  if (typeof host?.createBrowserTool !== 'function') throw new Error('Browser plugin requires its native host');
  return host.createBrowserTool(getSessionPath, options);
}
