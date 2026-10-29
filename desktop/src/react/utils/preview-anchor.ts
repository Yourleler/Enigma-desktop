/** Match only sanitized ids inside this document. Never interpolate a link
 * fragment into a CSS selector or use it as executable content. */
export function findPreviewAnchor(root: HTMLElement, anchor: string): HTMLElement | null {
  const ids=[anchor.normalize('NFC'),anchor.replace(/^user-content-/, '').normalize('NFC')];
  const elements=Array.from(root.querySelectorAll<HTMLElement>('.preview-markdown [id]'));
  for(const id of ids){const exact=elements.find(element=>element.id.normalize('NFC')===id);if(exact)return exact;}
  const folded=elements.filter(element=>ids.some(id=>element.id.normalize('NFC').toLowerCase()===id.toLowerCase()));
  return folded.length===1?folded[0]:null;
}

export function alignPreviewAnchor(body:HTMLElement, target:HTMLElement): void {
  body.scrollTop=Math.max(0,body.scrollTop+target.getBoundingClientRect().top-body.getBoundingClientRect().top-24);
}
