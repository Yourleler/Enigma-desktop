/** @vitest-environment jsdom */
import {describe, it, expect, vi} from 'vitest';
import {renderMarkdownPreview} from '../../utils/markdown';
import {workbenchMarkdownOptions, resolveWorkbenchMarkdownLink} from '../../utils/workbench-markdown';
import {copyValueForLink, openInternalLink, resolveLinkTarget} from '../../utils/link-open';
import {createLocalServerConnection} from '../../services/server-connection';
import type {RemoteWorkbenchContentRef} from '../../types';

const mocks=vi.hoisted(()=>({openWorkbenchFilePreview:vi.fn()}));
vi.mock('../../utils/remote-file-preview',()=>({openWorkbenchFilePreview:mocks.openWorkbenchFilePreview}));
const ref:RemoteWorkbenchContentRef={kind:'workbench-file',mountId:'new-test-mount',rootId:'new-test-mount',subdir:'guide',name:'start.md',contentPath:'/api/workbench/content'};
const connection=createLocalServerConnection({serverPort:14444,serverToken:'fixture-token'})!;
const scope={ref,baseUrl:connection.baseUrl};

describe('remote workbench Markdown resources',()=>{
  it('renders sibling images and links in the same mount without putting credentials in links',()=>{
    const html=renderMarkdownPreview('![Diagram](./assets/diagram.svg) [Next](../Next%20Note.md#details)',workbenchMarkdownOptions(ref,connection));
    const element=document.createElement('div');element.innerHTML=html;
    const image=new URL(element.querySelector('img')!.src),link=new URL(element.querySelector('a')!.href);
    expect(image.searchParams.get('mountId')).toBe(ref.mountId);
    expect(image.searchParams.get('subdir')).toBe('guide/assets');
    expect(image.searchParams.get('name')).toBe('diagram.svg');
    expect(image.searchParams.get('token')).toBe('fixture-token');
    expect(link.searchParams.get('token')).toBeNull();
    expect(link.searchParams.get('subdir')).toBe('');
    expect(link.searchParams.get('name')).toBe('Next Note.md');
    expect(link.hash).toBe('#details');
    expect(resolveLinkTarget(link.href,{workbenchScope:scope})).toMatchObject({kind:'workbench',ref:{mountId:ref.mountId,name:'Next Note.md',subdir:''}});
  });

  it('opens linked files through the authorized workbench content path and copies a credential-free path',async()=>{
    const href=workbenchMarkdownOptions(ref,connection).getLinkUrl!('/guide/next.md')!;
    await openInternalLink(href,{workbenchScope:scope});
    expect(mocks.openWorkbenchFilePreview).toHaveBeenCalledWith({file:{name:'next.md',isDir:false},mountId:ref.mountId,rootId:ref.rootId,subdir:'guide',preferNativePath:false});
    expect(copyValueForLink(href,{workbenchScope:scope})).toBe('guide/next.md');
  });

  it('does not attach the server credential to external images or links',()=>{
    const html=renderMarkdownPreview('![Outside](https://example.com/image.png) [Outside](https://example.com/page)',workbenchMarkdownOptions(ref,connection));
    expect(html).not.toContain('fixture-token');
    expect(html).toContain('https://example.com/image.png');
    expect(html).toContain('https://example.com/page');
  });

  it('retains content query parameters when a relative image has a cache suffix',()=>{
    const html=renderMarkdownPreview('![Diagram](./image.png?v=2)',workbenchMarkdownOptions(ref,connection));
    const element=document.createElement('div');element.innerHTML=html;
    const url=new URL(element.querySelector('img')!.src);
    expect(url.searchParams.get('name')).toBe('image.png');
    expect(url.searchParams.get('v')).toBe('2');
  });

  it('rejects another origin, mount, path traversal or encoded separator as a workbench target',()=>{
    const cases=[
      'https://example.com/api/workbench/content?mountId=new-test-mount&name=x.md',
      connection.baseUrl+'/api/workbench/content?mountId=another&name=x.md',
      connection.baseUrl+'/api/workbench/content?mountId=new-test-mount&subdir=../outside&name=x.md',
      connection.baseUrl+'/api/workbench/content?mountId=new-test-mount&name=dir%2Ffile.md',
      connection.baseUrl+'/api/workbench/content?mountId=new-test-mount&name=..',
    ];
    for(const href of cases)expect(resolveWorkbenchMarkdownLink(href,scope)).toBeNull();
  });

  it('preserves a routed server base path',()=>{
    const routed={...connection,baseUrl:connection.baseUrl+'/studio/test'};
    const href=workbenchMarkdownOptions(ref,routed).getLinkUrl!('/guide/next.md')!;
    expect(resolveWorkbenchMarkdownLink(href,{ref,baseUrl:routed.baseUrl})?.name).toBe('next.md');
  });

  it('keeps raw HTML relative links and unsafe protocols inert',()=>{
    const html=renderMarkdownPreview('<a href="./raw.md">raw</a><a href="javascript:alert(1)">bad</a>',workbenchMarkdownOptions(ref,connection));
    expect(html).not.toContain('href=');
  });
  it('does not let a remote document read local file images through raw HTML',()=>{
    const html=renderMarkdownPreview('<img src="file:///private/local.png" alt="local">',workbenchMarkdownOptions(ref,connection));
    expect(html).not.toContain('<img');
    expect(renderMarkdownPreview('<img src="file:///vault/image.png">')).toContain('file:///vault/image.png');
  });
});
