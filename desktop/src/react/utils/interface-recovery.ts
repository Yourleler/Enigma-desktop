/** React.lazy keeps a rejected module promise. Remounting cannot retry it;
 * an explicit page reload obtains the current entry and its matching assets. */
export function isModuleLoadError(error:Error|null) {
  return !!error&&/failed to fetch dynamically imported module|importing a module script failed|loading (?:css )?chunk .+ failed|error loading dynamically imported module/i.test(error.message||'');
}
export function reloadInterface(){window.location.reload();}
export function recoveryCopy(){
  const chinese=(window.i18n?.locale||document.documentElement.lang||navigator.language).startsWith('zh');
  return chinese?{
    moduleTitle:'界面组件未能加载',moduleHint:'可能是版本更新或连接中断。重新加载当前界面以获取匹配的组件。',reload:'重新加载界面',
    networkTitle:'连接暂时中断',networkHint:'请检查连接后重试。',renderTitle:'这部分界面暂时无法显示',renderHint:'可以重试恢复显示；仍然失败时重新加载界面。',retry:'重试',
  }:{
    moduleTitle:'Interface component could not load',moduleHint:'The app may have updated or the connection was interrupted. Reload to get matching interface files.',reload:'Reload interface',
    networkTitle:'Connection interrupted',networkHint:'Check your connection and retry.',renderTitle:'This area could not be displayed',renderHint:'Retry to restore this area. If it still fails, reload the interface.',retry:'Retry',
  };
}
