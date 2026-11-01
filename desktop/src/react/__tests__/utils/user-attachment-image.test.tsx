// @vitest-environment jsdom
import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {useUserAttachmentImageSrc} from '../../utils/user-attachment-media';
import {useStore} from '../../stores';

afterEach(()=>{cleanup();Reflect.deleteProperty(window,'platform');useStore.setState({activeServerConnectionId:null});});
it('loads a Web history thumbnail through the file bridge when no native URL is available',async()=>{
  const read=vi.fn(async()=>'IMAGE');
  window.platform={getFileUrl:()=>'',readFileBase64:read} as any;
  const {result}=renderHook(()=>useUserAttachmentImageSrc({path:'/uploads/image.png',name:'image.png',mimeType:'image/png',isDir:false}));
  await waitFor(()=>expect(result.current).toBe('data:image/png;base64,IMAGE'));
  expect(read).toHaveBeenCalledWith('/uploads/image.png');
});
it('ignores a late image from a previously selected server and never reads expired files',async()=>{
  const reads:Array<(data:string)=>void>=[];
  window.platform={getFileUrl:()=>'',readFileBase64:()=>new Promise(resolve=>reads.push(resolve))} as any;
  useStore.setState({activeServerConnectionId:'server-one'});
  const {result,rerender}=renderHook(({expired})=>useUserAttachmentImageSrc({path:'/uploads/image.png',name:'image.png',isDir:false,status:expired?'expired':undefined}),{initialProps:{expired:false}});
  act(()=>{useStore.setState({activeServerConnectionId:'server-two'});});
  await act(async()=>{reads[0]('OLD');});expect(result.current).toBeNull();
  await act(async()=>{reads[1]('CURRENT');});expect(result.current).toBe('data:image/png;base64,CURRENT');
  rerender({expired:true});expect(result.current).toBeNull();expect(reads).toHaveLength(2);
});
