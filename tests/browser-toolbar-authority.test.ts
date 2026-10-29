import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {expect,it,vi} from 'vitest';
const text=readFileSync('desktop/main.cjs','utf8');
const source=ts.createSourceFile('main.cjs',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
function declaration(name:string){const node=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);if(!node)throw Error(name);return node.getText(source);}
function handler(channel:string){
 const statement=source.statements.find(statement=>ts.isExpressionStatement(statement)&&ts.isCallExpression(statement.expression)&&statement.expression.arguments[0]&&ts.isStringLiteral(statement.expression.arguments[0])&&statement.expression.arguments[0].text===channel);
 if(!statement||!ts.isExpressionStatement(statement)||!ts.isCallExpression(statement.expression))throw Error(channel);
 return statement.expression.arguments[1].getText(source);
}
it('rejects foreign frames, changed workspace and a view moved into the sidebar',async()=>{
 const main={processId:10,routingId:20},wc={mainFrame:main};let docked=false;const command=vi.fn(async()=>({ok:true}));
 const scope={browserViewerWindow:{webContents:wc},_currentBrowserSession:'session-a',_browserWebView:{},_normalizeBrowserSessionPath:(s:unknown)=>typeof s==='string'&&s.trim()?s:null,_sidebarBrowser:{hasView:()=>docked},browserToolbarCommand:command};
 const context=vm.createContext(scope);vm.runInContext(declaration('assertBrowserViewerSender'),context);const run=vm.runInContext(`(${handler('browser-viewer-command')})`,context);
 await expect(run({sender:{},senderFrame:main},{sessionPath:'session-a'})).rejects.toThrow('toolbar');
 await expect(run({sender:wc,senderFrame:{processId:10,routingId:99}},{sessionPath:'session-a'})).rejects.toThrow('toolbar');
 const event={sender:wc,senderFrame:main};await expect(run(event,{sessionPath:'session-b'})).rejects.toThrow('归属');
 docked=true;await expect(run(event,{sessionPath:'session-a'})).rejects.toThrow('归属');
 docked=false;await run(event,{sessionPath:'session-a',action:'find',tabId:'tab-a',query:'test'});expect(command).toHaveBeenCalledOnce();expect(command).toHaveBeenCalledWith('session-a',expect.objectContaining({action:'find',tabId:'tab-a'}));
});
