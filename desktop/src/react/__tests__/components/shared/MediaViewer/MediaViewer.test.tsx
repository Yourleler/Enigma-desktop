/** @vitest-environment jsdom */
import {cleanup,render,screen,fireEvent} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {MediaViewer} from '../../../../components/shared/MediaViewer/MediaViewer';
import {useStore} from '../../../../stores';
const latest=vi.hoisted(()=>({props:null as any}));
vi.mock('../../../../components/shared/MediaViewer/PhotoSwipeSurface',()=>({PhotoSwipeSurface:(props:any)=>{latest.props=props;return <><button onClick={props.onClose}>关闭</button><button onClick={()=>props.onDock(props.files[0])}>侧栏</button></>;}}));
afterEach(()=>{cleanup();useStore.getState().closeMediaViewer();});
it('keeps mixed media identity and forwards gallery selection and close to the store',()=>{
 const files=[{id:'image',kind:'image',source:'desk',name:'image.png',path:'/new/image.png'},{id:'video',kind:'video',source:'desk',name:'video.webm',path:'/new/video.webm'}] as any;
 useStore.getState().setMediaViewer({files,currentId:'image',origin:'desk'});render(<MediaViewer/>);expect(latest.props.files).toHaveLength(2);latest.props.onCurrent('video');expect(useStore.getState().mediaViewer?.currentId).toBe('video');fireEvent.click(screen.getByText('关闭'));expect(useStore.getState().mediaViewer).toBeNull();
});
