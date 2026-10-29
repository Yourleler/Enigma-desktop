/** Native tools retain their host permission contract and stable model name.
 * Plugin ownership adds revocation even for a tool frozen in an older session. */
export function bindNativePluginTool(tool: any, {
  pluginId,
  isActive,
  controllers,
}: { pluginId: string; isActive: () => boolean; controllers: Set<AbortController> | (() => Set<AbortController>) }) {
  if (!tool?.name || typeof tool.execute !== 'function') throw new Error('Invalid native tool contribution');
  const available = tool.isEnabledForAgentConfig;
  return {
    ...tool,
    metadata: { ...tool.metadata, nativePluginId: pluginId },
    isEnabledForAgentConfig: (...args: any[]) => isActive() && (!available || available(...args)),
    async execute(callId: string, input: any, signal?: AbortSignal, onUpdate?: any, ctx?: any) {
      if (!isActive()) return {
        isError: true,
        content: [{ type: 'text', text: '操作插件已停用或更新，本次未执行。请检查设置 → 插件；更新插件后可重新打开会话。' }],
        details: { errorCode: 'INTERACTION_PLUGIN_DISABLED', pluginId },
      };
      const controller = new AbortController();
      const activeControllers = typeof controllers === 'function' ? controllers() : controllers;
      activeControllers.add(controller);
      try {
        const combined = signal && typeof signal.addEventListener === 'function'
          ? AbortSignal.any([signal, controller.signal]) : controller.signal;
        return await tool.execute(callId, input, combined, onUpdate, ctx);
      } finally { activeControllers.delete(controller); }
    },
  };
}

export function nativePluginPreferenceKey(entry: any) {
  return entry.source === 'builtin' ? `builtin:${entry.id}` : entry.id;
}

export function canToggleNativePlugin(entry: any) {
  return entry.source === 'builtin' && entry.manifest?.userToggleable === true;
}
