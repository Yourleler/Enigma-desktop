import {useEffect,useRef,useState} from 'react';
import {createInitFindReplaceState,FindBy,FindDirection,FindScope,type IFindReplaceService} from '@univerjs/preset-sheets-find-replace';

/** Preview search uses the upstream workbook index without exposing edits. */
export function SpreadsheetFind({service,onClose}:{service:IFindReplaceService;onClose:()=>void}) {
  const [state,setState]=useState(createInitFindReplaceState),[advanced,setAdvanced]=useState(false);
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    if(service.replaceRevealed)service.hideReplace();
    const stateSubscription=service.state$.subscribe(setState);
    const focusSubscription=service.focusSignal$.subscribe(()=>input.current?.focus());
    input.current?.focus();
    return()=>{stateSubscription.unsubscribe();focusSubscription.unsubscribe();};
  },[service]);
  return <section className="enigma-sheet-find" aria-label="表格查找" onKeyDown={event=>{
    event.stopPropagation();
    if(event.key==='Escape'){event.preventDefault();onClose();}
  }}>
    <div className="enigma-sheet-find-query">
      <input ref={input} aria-label="查找单元格" placeholder="输入文字或公式" value={state.findString} onChange={event=>service.changeFindString(event.target.value)} onKeyDown={event=>{
        if(event.key==='Enter'){event.preventDefault();event.shiftKey?service.moveToPreviousMatch():service.moveToNextMatch();}
      }}/>
      <output aria-live="polite">{!state.findString?'':state.matchesCount?`${state.matchesPosition} / ${state.matchesCount}`:'无匹配'}</output>
      <button type="button" aria-label="上一个匹配" title="上一个匹配 · Shift+Enter" disabled={!state.matchesCount} onClick={()=>service.moveToPreviousMatch()}>↑</button>
      <button type="button" aria-label="下一个匹配" title="下一个匹配 · Enter" disabled={!state.matchesCount} onClick={()=>service.moveToNextMatch()}>↓</button>
    </div>
    <button type="button" className="enigma-sheet-find-options" aria-expanded={advanced} onClick={()=>setAdvanced(value=>!value)}>查找选项</button>
    {advanced&&<div className="enigma-sheet-find-advanced">
      <label>范围<select value={state.findScope} onChange={event=>service.changeFindScope(event.target.value as FindScope)}><option value={FindScope.UNIT}>整个工作簿</option><option value={FindScope.SUBUNIT}>当前工作表</option></select></label>
      <label>内容<select value={state.findBy} onChange={event=>service.changeFindBy(event.target.value as FindBy)}><option value={FindBy.VALUE}>显示值</option><option value={FindBy.FORMULA}>公式</option></select></label>
      <label>顺序<select value={state.findDirection} onChange={event=>service.changeFindDirection(event.target.value as FindDirection)}><option value={FindDirection.ROW}>按行</option><option value={FindDirection.COLUMN}>按列</option></select></label>
      <label className="enigma-sheet-find-check"><input type="checkbox" checked={state.caseSensitive} onChange={event=>service.changeCaseSensitive(event.target.checked)}/>区分大小写</label>
      <label className="enigma-sheet-find-check"><input type="checkbox" checked={state.matchesTheWholeCell} onChange={event=>service.changeMatchesTheWholeCell(event.target.checked)}/>匹配整个单元格</label>
    </div>}
    <small>只读预览 · Enter 下一项 · Esc 关闭</small>
  </section>;
}
