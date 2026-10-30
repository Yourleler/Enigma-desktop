/** This bootstrap is for a same-origin browser on the actual loopback socket.
 * Neither forwarded headers nor a localhost Host alone prove local transport. */
export function isLocalBrowserSessionRequest({url,origin,fetchSite,marker,remoteAddress,connectionKind}:{url:string;origin?:string;fetchSite?:string;marker?:string;remoteAddress?:string;connectionKind?:string}){
  if(connectionKind!=='local'||marker!=='1'||fetchSite!=='same-origin')return false;
  const address=String(remoteAddress||'').replace(/^::ffff:/i,'');
  if(address!=='::1'&&!/^127(?:\.\d{1,3}){3}$/.test(address))return false;
  try{
    const target=new URL(url);
    return ['http:','https:'].includes(target.protocol)&&['127.0.0.1','localhost','[::1]'].includes(target.hostname)&&origin===target.origin;
  }catch{return false;}
}
