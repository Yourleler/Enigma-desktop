// The platform helper and approval gateway remain host-owned. Enabling this
// contribution does not grant OS permissions or authorize a target app.
export default function computerPlugin(options, host) {
  if (typeof host?.createComputerUseTool !== 'function') throw new Error('Computer plugin requires its native host');
  return host.createComputerUseTool(options);
}
