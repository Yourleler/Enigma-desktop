import {expect,it} from 'vitest';
import {normalizePreviewReadingPosition} from '../../../../../shared/preview-reading-position';
import {useStore} from '../../stores';
import {readingPositionsFromPersistedWorkspaceUiState} from '../../stores/workspace-ui-state-actions';
it('stores an explicit reading mode even before the document is scrolled',()=>{
 useStore.setState({previewReadingPositions:{note:{edit:{scrollTop:100}}},markdownPreviewIds:[]});useStore.getState().setMarkdownPreviewActive('note',true);
 const position=normalizePreviewReadingPosition(useStore.getState().previewReadingPositions.note)!;expect(position.mode).toBe('preview');expect(position.edit?.scrollTop).toBe(100);
 expect(readingPositionsFromPersistedWorkspaceUiState({previewTabs:[{id:'note',readingPosition:position}]},['note']).note.mode).toBe('preview');
 useStore.getState().setMarkdownPreviewActive('note',false);expect(useStore.getState().previewReadingPositions.note.mode).toBe('edit');expect(normalizePreviewReadingPosition({mode:'preview'})).toEqual({mode:'preview'});expect(normalizePreviewReadingPosition({mode:'invalid'})).toBeNull();
});
