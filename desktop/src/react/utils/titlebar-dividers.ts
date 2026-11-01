/** Mirror the painted panel edges in the same update as a resize. Geometry is
 * presentation state: scheduling a React render here can leave a frame behind. */
export function syncTitlebarDividers(root = document.querySelector<HTMLElement>('.enigma-titlebar-dividers')): void {
  const title = root?.parentElement?.getBoundingClientRect();
  if (!root || !title) return;
  // Read all geometry before writing positions to avoid alternating layout reads/writes.
  const positions = (['left', 'right'] as const).map(side => {
    const marker = root.querySelector<HTMLElement>(`[data-divider-side="${side}"]`);
    const panel = document.getElementById(side === 'left' ? 'sidebar' : 'jianSidebar');
    const rect = panel?.getBoundingClientRect();
    return {marker, visible: !!rect && rect.width > 1 && !panel?.classList.contains('collapsed'),
      x: rect ? (side === 'left' ? rect.right : rect.left) - title.left : 0};
  });
  for (const {marker, visible, x} of positions) {
    if (!marker) continue;
    marker.hidden = !visible;
    if (visible && marker.style.left !== `${x}px`) marker.style.left = `${x}px`;
  }
}
