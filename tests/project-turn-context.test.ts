import {describe,it,expect} from 'vitest';
import {withProjectTurnContext} from '../core/project-turn-context';
import {SessionProjectCatalogStore} from '../core/session-project-catalog-store';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
describe('project context ownership',()=>{
  it('shares only the selected project and keeps current turn context',()=>{
    const catalog={folders:[],projects:[{id:'p1',name:'One',folderId:null,order:0,sharedContext:'API v2',sharedNotes:'Verified contract',repositoryPaths:['/repo/a'],updatedAt:1},{id:'p2',name:'Two',folderId:null,order:1,sharedContext:'Secret from other project'}]};
    const result=withProjectTurnContext(catalog,'p1','/elsewhere',{beforeUser:'Current task',afterUser:'Current limits'});
    expect(result.beforeUser).toContain('API v2');expect(result.beforeUser).toContain('Current task');expect(result.beforeUser).not.toContain('Secret from other project');expect(result.afterUser).toBe('Current limits');
    expect(withProjectTurnContext(catalog,'cwd:','/repo/a',null)).toBeNull();
    catalog.projects[0].sharedContext='New contract';expect(withProjectTurnContext(catalog,'p1',null,null).beforeUser).toContain('New contract');
  });
  it('persists shared settings, detects stale editors and applies explicit clearing',()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'project-context-'));
    try{
      const store=new SessionProjectCatalogStore({userDir:root});const p=store.createProject({name:'Shared'});
      const saved=store.updateProject(p.id,{sharedContext:'Hello',sharedNotes:'Evidence',repositoryPaths:['/a','/b'],expectedUpdatedAt:p.updatedAt});
      expect(new SessionProjectCatalogStore({userDir:root}).getCatalog().projects[0].sharedContext).toBe('Hello');
      expect(()=>store.updateProject(p.id,{sharedContext:'Old',expectedUpdatedAt:p.updatedAt})).toThrow('其他窗口');
      store.updateProject(p.id,{sharedContext:'',sharedNotes:'',repositoryPaths:[],expectedUpdatedAt:saved.updatedAt});
      expect(withProjectTurnContext(store.getCatalog(),p.id,null,null)).toBeNull();
    }finally{fs.rmSync(root,{recursive:true,force:true});}
  });
});
