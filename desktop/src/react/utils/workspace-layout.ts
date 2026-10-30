import { CHAT_MIN_WIDTH, PREVIEW_MIN_WIDTH } from '../layout-constants';

export type LayoutDrawer = 'sidebar' | 'workspace' | null;
export type LayoutIntent = Exclude<LayoutDrawer, null> | 'preview';

interface LayoutInput {
  width: number;
  sidebarWidth: number;
  workspaceWidth: number;
  previewWidth: number;
  inspectorWidth: number;
  sidebarWanted: boolean;
  workspaceWanted: boolean;
  sidebarAutoCollapsed: boolean;
  workspaceAutoCollapsed: boolean;
  previewOpen: boolean;
  engineeringDrawer: boolean;
  drawer: LayoutDrawer;
  intent?: LayoutIntent;
}

/** Auxiliary panes yield before the conversation or document becomes unreadable.
 * Auto-collapse is transient; it never changes the user's saved open/width choice. */
export function resolveWorkspaceLayout(input: LayoutInput) {
  const width = Math.max(0, input.width);
  const compact = width <= 860;
  const previewExpanded = input.previewOpen && width < CHAT_MIN_WIDTH + PREVIEW_MIN_WIDTH;
  const previewWidth = input.previewOpen
    ? previewExpanded ? width : Math.min(Math.max(PREVIEW_MIN_WIDTH, input.previewWidth), width - CHAT_MIN_WIDTH)
    : 0;
  let remaining = width - (previewExpanded ? width : Math.min(width, CHAT_MIN_WIDTH) + previewWidth) - input.inspectorWidth;
  const restoreGap = 48;
  const workspaceInline = input.workspaceWanted && !compact && !input.engineeringDrawer
    && remaining >= input.workspaceWidth + (input.workspaceAutoCollapsed ? restoreGap : 0);
  if (workspaceInline) remaining -= input.workspaceWidth;
  const sidebarInline = input.sidebarWanted && !compact
    && remaining >= input.sidebarWidth + (input.sidebarAutoCollapsed ? restoreGap : 0);
  let drawer: LayoutDrawer = input.intent === 'preview' ? null : input.drawer;
  if (input.intent === 'sidebar') drawer = sidebarInline ? null : 'sidebar';
  if (input.intent === 'workspace') drawer = workspaceInline ? null : 'workspace';
  if (input.engineeringDrawer && input.workspaceWanted && input.intent !== 'preview'
    && (!input.previewOpen || input.drawer === 'workspace' || input.intent === 'workspace')) drawer = 'workspace';
  if (drawer === 'sidebar' && (!input.sidebarWanted || sidebarInline)) drawer = null;
  if (drawer === 'workspace' && (!input.workspaceWanted || workspaceInline)) drawer = null;
  return {
    sidebarOpen: sidebarInline || drawer === 'sidebar',
    sidebarAutoCollapsed: input.sidebarWanted && !sidebarInline && drawer !== 'sidebar',
    jianOpen: workspaceInline || drawer === 'workspace',
    jianAutoCollapsed: input.workspaceWanted && !workspaceInline && drawer !== 'workspace',
    layoutDrawer: drawer,
    previewExpanded,
    previewWidth,
  };
}
