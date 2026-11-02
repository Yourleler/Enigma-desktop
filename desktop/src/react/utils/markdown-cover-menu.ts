import './markdown-cover-menu.css';

export interface CoverMenuAction {
  label: string;
  run: () => void;
  danger?: boolean;
}

/** Both Markdown renderers use the same floating menu and keyboard behavior. */
export function openMarkdownCoverMenu(
  anchor: HTMLElement,
  point: { x: number; y: number },
  actions: CoverMenuAction[],
  onClose?: () => void,
): () => void {
  const doc = anchor.ownerDocument;
  const win = doc.defaultView || window;
  const menu = doc.createElement('div');
  menu.className = 'markdown-cover-menu';
  menu.dataset.menuSurface = '';
  menu.dataset.menuPosition = 'fixed';
  menu.dataset.liquid = 'menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', '封面操作');
  const previousFocus = doc.activeElement;
  let closed = false;
  const close = (restoreFocus = false) => {
    if (closed) return;
    closed = true;
    menu.remove();
    win.removeEventListener('pointerdown', outside);
    win.removeEventListener('blur', dismiss);
    win.removeEventListener('resize', dismiss);
    doc.removeEventListener('scroll', scroll, true);
    if (restoreFocus && previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    onClose?.();
  };
  const dismiss = () => close();
  const outside = (event: PointerEvent) => { if (!menu.contains(event.target as Node)) close(); };
  const scroll = (event: Event) => { if (!menu.contains(event.target as Node)) close(); };
  const buttons = actions.map(action => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = action.label;
    button.setAttribute('role', 'menuitem');
    button.dataset.menuRow = '';
    if (action.danger) button.className = 'danger';
    button.addEventListener('click', () => { close(true); action.run(); });
    menu.append(button);
    return button;
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
      close(true);
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const current = buttons.indexOf(doc.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }
  });
  doc.body.append(menu);
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(12, Math.min(point.x, win.innerWidth - bounds.width - 12))}px`;
  menu.style.top = `${Math.max(12, Math.min(point.y, win.innerHeight - bounds.height - 12))}px`;
  buttons[0]?.focus({ preventScroll: true });
  win.addEventListener('pointerdown', outside);
  win.addEventListener('blur', dismiss);
  win.addEventListener('resize', dismiss);
  doc.addEventListener('scroll', scroll, true);
  return dismiss;
}
