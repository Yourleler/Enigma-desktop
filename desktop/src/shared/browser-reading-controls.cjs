/** Native Chromium reading controls, scoped to one live WebContents. */
function createBrowserReadingControls(webContents,publish=()=>{}) {
  let requestId=null;
  let find={query:'',matches:0,active:0,pending:false,matchCase:false};
  const snapshot=()=>({zoomFactor:webContents.isDestroyed()?1:webContents.getZoomFactor(),find:{...find}});
  const reset=()=>{requestId=null;find={query:'',matches:0,active:0,pending:false,matchCase:false};};
  const onFound=(_event,result)=>{
    if(result.requestId!==requestId)return;
    find={...find,matches:result.matches,active:result.activeMatchOrdinal,pending:!result.finalUpdate};publish();
  };
  const onNavigate=(_event,_url,inPlace,mainFrame)=>{if(mainFrame&&!inPlace){reset();publish();}};
  webContents.on('found-in-page',onFound);webContents.on('did-start-navigation',onNavigate);
  const command=(action,options={})=>{
    if(webContents.isDestroyed())throw new Error('网页已关闭，请重新打开');
    if(action==='find'){
      if(typeof options.query!=='string'||options.query.length>1024)throw new Error('查找文字过长');
      const query=options.query,matchCase=options.matchCase===true;
      if(!query){webContents.stopFindInPage('clearSelection');reset();}
      else{
        const continued=options.next===true&&query===find.query&&matchCase===find.matchCase;
        find={query,matches:continued?find.matches:0,active:continued?find.active:0,pending:true,matchCase};
        // Electron's findNext=true starts a new search; false advances it.
        requestId=webContents.findInPage(query,{forward:options.forward!==false,findNext:!continued,matchCase});
      }
    }else if(action==='stopFind'){webContents.stopFindInPage('clearSelection');reset();}
    else if(action==='zoom'){
      const factor=Number(options.zoomFactor);
      if(!Number.isFinite(factor)||factor<.25||factor>3)throw new Error('页面缩放范围为 25%–300%');
      webContents.setZoomFactor(factor);
    }else throw new Error('不支持的阅读操作');
    publish();return snapshot();
  };
  const dispose=()=>{webContents.removeListener('found-in-page',onFound);webContents.removeListener('did-start-navigation',onNavigate);};
  webContents.once('destroyed',dispose);
  return {snapshot,command,dispose};
}
function validateBrowserPageTarget(command,activeId) {
  if(['navigate','back','forward','reload','stop','find','stopFind','zoom','openExternal','focusPage'].includes(command.action)&&(command.tabId||null)!==(activeId||null))throw new Error('当前标签页已变化，请确认页面后重试');
}
function browserViewerBounds(size,headerHeight=116) {
  const [width,height]=size;
  const top=Math.max(44,Math.min(Number.isFinite(headerHeight)?headerHeight:116,height));
  return {x:8,y:Math.ceil(top)+4,width:Math.max(0,width-16),height:Math.max(0,height-Math.ceil(top)-12)};
}
module.exports={createBrowserReadingControls,validateBrowserPageTarget,browserViewerBounds};
