/**
 * useSidebarResize — 侧边栏宽度拖拽调整
 *
 * 从 sidebar-shim.ts 的 initSidebarResize 迁移。
 * 在 useEffect 中绑定 resize handle 事件，并在 unmount 时完整清理。
 */

import { useEffect, useState } from 'react';
import { useStore } from '../stores';
import { CHAT_MIN_WIDTH, PREVIEW_MIN_WIDTH } from '../layout-constants';
import { updateLayout } from '../components/SidebarLayout';

type ResizeMax = number | (() => number);

export function useSidebarResize(): void {
  const currentTab = useStore(s => s.currentTab);
  const currentChannel = useStore(s => s.currentChannel);
  const previewOpen = useStore(s => s.previewOpen);
  const [mountRevision, setMountRevision] = useState(0);

  // Web panes load lazily. Bind when their real handles replace the fallback,
  // including when a saved preview was already open before the module loaded.
  useEffect(() => {
    const ids = ['sidebarResizeHandle','jianResizeHandle','previewResizeHandle'];
    let handles = ids.map(id => document.getElementById(id));
    const observer = new MutationObserver(() => {
      const next = ids.map(id => document.getElementById(id));
      if (next.some((handle, i) => handle !== handles[i])) { handles = next; setMountRevision(value => value + 1); }
    });
    observer.observe(document.querySelector('.app') || document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const sidebarEl = document.getElementById('sidebar');
    const jianSidebarEl = document.getElementById('jianSidebar');
    const leftHandle = document.getElementById('sidebarResizeHandle');
    const rightHandle = document.getElementById('jianResizeHandle');
    const previewPanel = document.getElementById('previewPanel');

    const LEFT_MIN = 200, LEFT_MAX = 400;
    const RIGHT_MIN = 320, RIGHT_MAX = 900;
    const PREVIEW_MIN = PREVIEW_MIN_WIDTH;

    const leftInner = sidebarEl?.querySelector('.sidebar-inner') as HTMLElement | null;
    const rightInner = jianSidebarEl?.querySelector('.jian-sidebar-inner') as HTMLElement | null;
    const previewInner = previewPanel?.querySelector('[data-preview-panel-inner]') as HTMLElement | null;

    function clampWidth(value: number, min: number, max: number): number {
      const upper = Number.isFinite(max) ? Math.max(min, max) : min;
      return Math.max(min, Math.min(upper, value));
    }

    function createResizeEventShield(): () => void {
      const shield = document.createElement('div');
      shield.setAttribute('data-resize-event-shield', '');
      Object.assign(shield.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483647',
        cursor: 'col-resize',
        background: 'transparent',
      });
      document.body.appendChild(shield);
      return () => {
        shield.remove();
      };
    }

    function getPreviewMaxWidth(): number {
      return Math.max(PREVIEW_MIN, window.innerWidth - CHAT_MIN_WIDTH);
    }

    function applySidebarWidth(w: number): void {
      const px = w + 'px';
      root.style.setProperty('--sidebar-preferred-width',px);
      localStorage.setItem('hana-sidebar-width',String(w));
    }

    function updateJianColumns(w: number): void {
      const cols = w > 520 ? 3 : w > 350 ? 2 : 1;
      root.style.setProperty('--jian-columns', String(cols));
    }

    function applyJianWidth(w: number): void {
      const px = w + 'px';
      root.style.setProperty('--jian-sidebar-width', px);
      root.style.setProperty('--right-dock-width',px);
      root.style.setProperty('--right-dock-preferred-width',px);
      localStorage.setItem('enigma-dock-width',String(w));
      updateJianColumns(w);
    }

    function applyPreviewWidth(w: number): void {
      const px = w + 'px';
      root.style.setProperty('--preview-preferred-width', px);
      root.style.setProperty('--preview-panel-width', px);
      if (previewInner) { previewInner.style.width = px; previewInner.style.minWidth = px; }
    }

    // 恢复保存的宽度
    const savedLeft = localStorage.getItem('hana-sidebar-width');
    const savedRight = localStorage.getItem('enigma-dock-width');
    const savedPreview = localStorage.getItem('hana-preview-width');
    if (savedLeft) applySidebarWidth(Number(savedLeft));
    if (savedRight) applyJianWidth(Number(savedRight));
    if (savedPreview) {
      const savedPreviewWidth = Number(savedPreview);
      if (Number.isFinite(savedPreviewWidth)) {
        applyPreviewWidth(Math.max(PREVIEW_MIN, savedPreviewWidth));
      }
    }

    const fitPreviewToWindow = () => updateLayout();
    fitPreviewToWindow();
    window.addEventListener('resize', fitPreviewToWindow);

    const cleanupFns: Array<() => void> = [];

    function setupHandle(
      handle: HTMLElement | null,
      getSidebar: () => HTMLElement | null,
      getWidth: () => number,
      setWidth: (w: number) => void,
      min: number,
      max: ResizeMax,
      storageKey: string,
      isRight: boolean,
    ): void {
      if (!handle) return;

      const onHandleMove = (e: MouseEvent) => {
        const rect = handle.getBoundingClientRect();
        handle.style.setProperty('--handle-y', (e.clientY - rect.top) + 'px');
      };
      const onHandleLeave = () => {
        handle.style.setProperty('--handle-y', '-999px');
      };

      let activeDragCleanup: (() => void) | null = null;
      let removeResizeShield: (() => void) | null = null;

      const onMouseDown = (e: MouseEvent) => {
        activeDragCleanup?.();
        activeDragCleanup = null;
        removeResizeShield = null;

        e.preventDefault();
        const sidebarTarget = getSidebar();
        if (!sidebarTarget || sidebarTarget.classList.contains('collapsed')) return;

        const startX = e.clientX;
        const startW = getWidth();
        let liveWidth = startW;
        handle.classList.add('active');
        document.body.classList.add('resizing');
        removeResizeShield = createResizeEventShield();

        function onMove(e: MouseEvent): void {
          const delta = isRight ? startX - e.clientX : e.clientX - startX;
          const maxWidth = typeof max === 'function' ? max() : max;
          const w = clampWidth(startW + delta, min, maxWidth);
          liveWidth = w;
          setWidth(w);
          updateLayout(storageKey === 'hana-sidebar-width' ? 'sidebar' : storageKey === 'hana-jian-width' ? 'workspace' : 'preview');
          const rect = handle!.getBoundingClientRect();
          handle!.style.setProperty('--handle-y', (e.clientY - rect.top) + 'px');
        }

        function onUp(): void {
          handle!.classList.remove('active');
          document.body.classList.remove('resizing');
          handle!.style.setProperty('--handle-y', '-999px');
          removeResizeShield?.();
          removeResizeShield = null;
          const w = liveWidth;
          localStorage.setItem(storageKey, String(w));
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          activeDragCleanup = null;
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        activeDragCleanup = () => {
          handle.classList.remove('active');
          document.body.classList.remove('resizing');
          handle.style.setProperty('--handle-y', '-999px');
          removeResizeShield?.();
          removeResizeShield = null;
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          activeDragCleanup = null;
        };
      };

      handle.addEventListener('mousemove', onHandleMove);
      handle.addEventListener('mouseleave', onHandleLeave);
      handle.addEventListener('mousedown', onMouseDown);

      cleanupFns.push(() => {
        activeDragCleanup?.();
        handle.removeEventListener('mousemove', onHandleMove);
        handle.removeEventListener('mouseleave', onHandleLeave);
        handle.removeEventListener('mousedown', onMouseDown);
      });
    }

    setupHandle(
      leftHandle,
      () => sidebarEl,
      () => sidebarEl?.offsetWidth || 240,
      (w) => applySidebarWidth(w),
      LEFT_MIN, LEFT_MAX, 'hana-sidebar-width', false,
    );

    setupHandle(
      rightHandle,
      () => jianSidebarEl,
      () => jianSidebarEl?.offsetWidth || 260,
      (w) => applyJianWidth(w),
      RIGHT_MIN, RIGHT_MAX, 'hana-jian-width', true,
    );

    const previewHandle = document.getElementById('previewResizeHandle');
    setupHandle(
      previewHandle,
      () => previewPanel,
      () => previewPanel?.offsetWidth || 580,
      (w) => applyPreviewWidth(w),
      PREVIEW_MIN, getPreviewMaxWidth, 'hana-preview-width', true,
    );

    return () => {
      window.removeEventListener('resize', fitPreviewToWindow);
      for (const cleanup of cleanupFns) cleanup();
    };
  }, [currentTab, currentChannel, previewOpen, mountRevision]);
}
