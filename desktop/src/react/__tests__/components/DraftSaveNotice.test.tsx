// @vitest-environment jsdom
import {afterEach,it,expect,vi} from 'vitest';import {act,cleanup,render,screen} from '@testing-library/react';import '@testing-library/jest-dom/vitest';
import {DraftSaveNotice} from '../../components/input/DraftSaveNotice';import {useDraftSaveState} from '../../stores/input-draft-persistence';
afterEach(()=>cleanup());
it('keeps successful, pending and locally saved offline drafts silent through repeated updates',()=>{
 useDraftSaveState.setState({items:{draft:{state:'saved',localDurable:true}}});render(<DraftSaveNotice draftKey="draft"/>);
 for(const state of ['pending','saved','offline','pending','saved']as const){act(()=>useDraftSaveState.setState({items:{draft:{state,localDurable:true}}}));expect(document.querySelector('.enigma-draft-save')).toBeNull();}
});
it('keeps actionable conflicts and local durability failures visible',()=>{
 useDraftSaveState.setState({items:{draft:{state:'conflict',localDurable:true}}});render(<DraftSaveNotice draftKey="draft"/>);expect(screen.getByText('比较版本')).toBeInTheDocument();
 act(()=>useDraftSaveState.setState({items:{draft:{state:'local-error',localDurable:false}}}));expect(screen.getByText('重试保存')).toBeInTheDocument();
});
