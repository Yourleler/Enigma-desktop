import {expect,it} from 'vitest';
import {prepareReadingMaterial,validateReadingAnnotation} from '../plugins/enigma/reading-material';

it('packs every source node and file beyond former caps into complete bounded JSON',()=>{
 const nodes=Array.from({length:139},(_,i)=>({id:`node-${i}`,role:'implementation',source:{repo:'r',file:`file-${i}.ts`,line:1,snippet:'Quotes " and Chinese 中文\n'.repeat(30)}}));
 const changes=nodes.map(n=>({repo:'r',file:n.source.file,change:'modified',patch:'+ text\\quoted"\n'.repeat(20)}));
 const edges=nodes.slice(1).map((n,i)=>({from:nodes[i].id,to:n.id,confidence:'confirmed'}));
 const material=prepareReadingMaterial({nodes,edges},changes,18000);
 expect(material.batches.length).toBeGreaterThan(1);
 expect(material.batches.flatMap(b=>b.nodes).map(n=>n.id)).toEqual(nodes.map(n=>n.id));
 expect(material.batches.flatMap(b=>b.changes).map(c=>c.file)).toEqual(changes.map(c=>c.file));
 for(const batch of material.batches){const text=JSON.stringify(batch);expect(text.length).toBeLessThanOrEqual(18000);expect(JSON.parse(text)).toEqual(batch);const ids=new Set(batch.nodes.map(n=>n.id));expect(batch.edges.every(e=>ids.has(e.from)&&ids.has(e.to))).toBe(true);}
 expect(material.coverage).toMatchObject({requests:0,nodes:0,totalNodes:139,changes:0,totalChanges:139,status:'pending'});
});

it('marks individual clipping and rejects anchors from another batch even if published',()=>{
 const material=prepareReadingMaterial({nodes:[{id:'a',source:{repo:'r',file:'a.ts',snippet:'x'.repeat(10000)}},{id:'b',source:{repo:'r',file:'b.ts',snippet:'y'.repeat(10000)}}],edges:[]},[{repo:'r',file:'a.ts',patch:'+'.repeat(9000)}],6000);
 expect(material.coverage.clippedNodes).toBe(2);expect(material.coverage.clippedPatches).toBe(1);
 const first=material.batches[0];expect(first.nodes[0].source.truncated).toBe(true);expect(first.changes[0].patchTruncated).toBe(true);
 expect(()=>validateReadingAnnotation({chapters:[{title:'Unsupported',summary:'Second node',nodes:['b']}],insights:[]},first,0)).toThrow('本批未提供');
 expect(validateReadingAnnotation({chapters:[{title:'One source',summary:'Grounded',nodes:['a']}],insights:[]},first,0).chapters[0]).toMatchObject({id:'batch-1-1',nodes:['a']});
});
it('counts source snippets already shortened by the source reader, and rejects a missing response schema',()=>{
 const material=prepareReadingMaterial({nodes:[{id:'n',source:{repo:'r',file:'one.ts',snippet:'one visible line',truncated:true}}],edges:[]},[]);
 expect(material.coverage.clippedNodes).toBe(1);expect(()=>validateReadingAnnotation({},material.batches[0],0)).toThrow('缺少');
});
