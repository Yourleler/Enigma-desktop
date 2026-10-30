import {AppIcon,type AppIconName} from '../../ui/app-icons';
export function DockIcon({name}:{name:AppIconName|'browser'|'changes'|'search'}) {
  if(name==='search')return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>;
  if(name==='browser')return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9.2"/><circle cx="12" cy="12" r="4"/><path d="M12 8h8.2M15.46 14l-4.1 7.1M8.54 14 4.4 6.9"/></svg>;
  if(name==='changes')return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8m-4-3v6M8 16h8"/></svg>;
  return <AppIcon name={name} size={16}/>;
}
