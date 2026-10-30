// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {FileStatusProvider,FileStatusBadge,fileOperationLabel} from '../../components/right-workspace/FileStatus';
import {useStore} from '../../stores';
import type {FileRef} from '../../types/file-ref';
vi.mock('../../hooks/use-hana-fetch',()=>({hanaFetch:vi.fn(async()=>({ok:true,json:async()=>({git:true,repositories:[{root:'/project',id:'main',files:[{path:'new.txt',status:'added'}]}]})}))}));
beforeEach(()=>useStore.setState({currentSessionPath:'/test/session',activeServerConnectionId:'test'}));afterEach(cleanup);
it('keeps upload provenance distinct from the source file Git status',async()=>{
 const file:FileRef={id:'new',kind:'other',source:'session-registry',path:'/project/new.txt',name:'new.txt',operations:['uploaded']};
 render(<FileStatusProvider><FileStatusBadge path="/project/new.txt"/><FileStatusBadge file={file}/></FileStatusProvider>);
 expect(await screen.findByText('新增')).toBeVisible();expect(screen.getByText('已上传')).toBeVisible();expect(screen.getByText('已上传')).toHaveAttribute('title',expect.stringContaining('Git 未提交状态：新增'));
});
it('reports only recorded operations and marks unavailable files',()=>{
 expect(fileOperationLabel({source:'session-registry',operations:[]})).toBeNull();
 expect(fileOperationLabel({source:'session-registry',operations:['created','modified']})).toBe('修改');
 expect(fileOperationLabel({source:'session-registry',status:'expired',operations:['uploaded']})).toBe('文件不可用');
});
