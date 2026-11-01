// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ChangeOverview} from '../ChangeOverview';
import {ChangeMap} from '../ChangeMap';
afterEach(cleanup);
it('separates known diff line counts from unreadable files and retains repository source identity',()=>{
 const onSource=vi.fn();render(<ChangeOverview publication={{version:'one',roots:[{id:'api',name:'API'},{id:'client',name:'Client',dependsOn:['api']}],changes:[{repo:'api',file:'same.ts',change:'modified',patch:'--- old\n+++ new\n@@ -1 +1,2 @@\n-old\n+new\n+line'},{repo:'client',file:'same.ts',change:'added',patchTruncated:true,patch:'+partial'}]}} onSource={onSource}/>);
 expect(screen.getByText('+2')).toBeVisible();expect(screen.getByText('−1')).toBeVisible();expect(screen.getByText('行数仅含可完整读取的文本')).toBeVisible();
 fireEvent.click(screen.getByText('查看文件与仓库').closest('summary')!);fireEvent.click(screen.getAllByRole('button',{name:'same.ts'})[1]);
 expect(onSource).toHaveBeenCalledWith({repo:'client',file:'same.ts',line:1});
});
it('exposes saved repository dependencies and layer sources without inventing missing relationships',()=>{
 const onSource=vi.fn(),node={id:'n',role:'consumer',source:{repo:'client',file:'same.ts',line:4,symbol:'consume'}};
 render(<ChangeMap reading={{nodes:[node],edges:[],architecture:[{repo:'client',responsibility:'Calls the API',nodes:['n'],dependsOn:['api']}],layers:[{id:'consumer',title:'Consumers',summary:'Review callers',nodes:['n']}],gaps:[]}} onSource={onSource}/>);
 fireEvent.click(screen.getByRole('button',{name:'仓库关系'}));expect(screen.getByText('依赖：api')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:/consume/}));expect(onSource).toHaveBeenCalledWith(node.source);
 fireEvent.click(screen.getByRole('button',{name:'分层阅读'}));expect(screen.getByText('Consumers')).toBeVisible();expect(screen.getByText('Review callers')).toBeVisible();
});
