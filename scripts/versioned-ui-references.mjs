/** Stable bootstrap URLs from older builds were served as immutable. New HTML
 * must change those URLs too; changing cache headers alone cannot evict a fresh
 * year-long entry already stored in a user's browser. */
export function versionedUiReferences(html, version) {
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) throw new Error('Invalid renderer version');
  const result=html.replace(/\b(href|src)=(["'])((?:\.\/)?(?:lib|themes|locales)\/[^"'?#]+)(?:\?[^"'#]*)?\2/g,
    (_match,attribute,quote,url)=>`${attribute}=${quote}${url}?v=${encodeURIComponent(version)}${quote}`);
  const tag=`<meta name="enigma-ui-version" content="${version}">`;
  return result.includes('name="enigma-ui-version"')
    ? result.replace(/<meta\s+name="enigma-ui-version"\s+content="[^"]*"\s*\/?\s*>/g,tag)
    : result.replace(/<head\b[^>]*>/i,head=>head+'\n'+tag);
}
