/** Resolve typed addresses without sending text to an external search service. */
export function resolveBrowserAddress(value:string):string {
  const raw=value.trim();
  if(!raw)throw new Error('请输入完整网址，例如 https://example.com');
  const loopback=/^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(raw);
  const host=/^[\w.-]+(?::\d+)?(?:[/?#]|$)/.test(raw);
  let url:URL;
  try {url=new URL(/^https?:\/\//i.test(raw)?raw:loopback?`http://${raw}`:host?`https://${raw}`:raw);}
  catch {throw new Error('请输入完整网址，例如 https://example.com');}
  if(!['http:','https:'].includes(url.protocol))throw new Error('只支持 http 和 https 网页');
  return url.href;
}
