import { EditorView, WidgetType, Decoration } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { EditorState, RangeSetBuilder, StateField, Transaction, Facet } from '@codemirror/state';
import {
  findMarkdownCoverRenderRange,
  parseMarkdownCover,
  removeMarkdownCover,
  resolveMarkdownCoverImagePath,
  updateMarkdownCoverLayout,
  type MarkdownCover,
  type MarkdownCoverLayoutPatch,
} from '../utils/markdown-cover';
import {
  isExternalCoverImagePath,
  regenerateMarkdownCoverWithPrompt,
  saveMarkdownCoverImage,
} from '../utils/markdown-cover-actions';
import {beginMarkdownCoverDrag,type CoverLayout} from '../utils/markdown-cover-drag';
import {openMarkdownCoverMenu} from '../utils/markdown-cover-menu';
import type {MarkdownCoverTargetInput} from '../utils/markdown-cover-generation';
import { markdownImageContextFacet } from './md-decorations';

export const markdownCoverTargetFacet=Facet.define<MarkdownCoverTargetInput|null,MarkdownCoverTargetInput|null>({combine:values=>values[0]??null});

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Number(value)));
}

interface MarkdownCoverElement extends HTMLElement {
  __hanaMarkdownCoverCleanup?: () => void;
}

function resolveCoverImageUrl(imagePath: string | null, getFileUrl?: (path: string) => string | undefined): string | null {
  if (!imagePath) return null;
  if (isExternalCoverImagePath(imagePath)) return imagePath;
  return getFileUrl?.(imagePath) || imagePath;
}

function updateCoverLayout(view: EditorView, patch: MarkdownCoverLayoutPatch): void {
  if(view.state.readOnly)return;
  const source = view.state.doc.toString();
  const nextSource = updateMarkdownCoverLayout(source, patch);
  if (nextSource === source) return;
  view.dispatch({
    changes: { from: 0, to: source.length, insert: nextSource },
    annotations: Transaction.userEvent.of('input'),
  });
}

function deleteCover(view: EditorView): void {
  if(view.state.readOnly)return;
  const source = view.state.doc.toString();
  const nextSource = removeMarkdownCover(source);
  if (nextSource === source) return;
  view.dispatch({
    changes: { from: 0, to: source.length, insert: nextSource },
    annotations: Transaction.userEvent.of('delete'),
  });
}

function parseCssNumber(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value || "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

interface MarkdownCoverEditorState {
  decorations: DecorationSet;
  hasTopCover: boolean;
}

const coverLineDecoration = Decoration.line({ class: 'cm-markdown-cover-line' });

class MarkdownCoverWidget extends WidgetType {
  constructor(
    readonly cover: MarkdownCover,
    readonly markdownFilePath?: string,
    readonly getFileUrl?: (path: string) => string | undefined,
    readonly isTopCover = false,
    readonly target: MarkdownCoverTargetInput|null = null,
  ) {
    super();
  }

  eq(other: MarkdownCoverWidget): boolean {
    return this.cover.image === other.cover.image
      && this.cover.displayWidth === other.cover.displayWidth
      && this.cover.displayHeight === other.cover.displayHeight
      && this.cover.positionX === other.cover.positionX
      && this.cover.positionY === other.cover.positionY
      && this.markdownFilePath === other.markdownFilePath
      && this.isTopCover === other.isTopCover;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div') as MarkdownCoverElement;
    wrapper.className = 'cm-markdown-cover';
    if (this.isTopCover) wrapper.classList.add('cm-markdown-cover-top');
    wrapper.contentEditable = 'false';

    const displayWidth = clamp(this.cover.displayWidth, 40, 100, 100);
    const displayHeight = clamp(this.cover.displayHeight, 160, 720, 320);
    const positionX = clamp(this.cover.positionX, 0, 100, 50);
    const positionY = clamp(this.cover.positionY, 0, 100, 50);

    if (displayWidth >= 100) {
      wrapper.classList.add('cm-markdown-cover-bleed-x');
    } else {
      wrapper.style.width = `${displayWidth}%`;
    }
    wrapper.style.height = `${displayHeight}px`;

    const imagePath = resolveMarkdownCoverImagePath(this.markdownFilePath, this.cover.image);
    const src = resolveCoverImageUrl(imagePath, this.getFileUrl);
    if (!src) {
      wrapper.classList.add('cm-markdown-cover-missing');
      wrapper.textContent = '封面图片不可用';
      return wrapper;
    }

    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.draggable = false;
    img.style.objectPosition = `${positionX}% ${positionY}%`;
    wrapper.appendChild(img);

    const resize = document.createElement('div');
    resize.className = 'cm-markdown-cover-resize';
    wrapper.appendChild(resize);

    let closeMenu=()=>{};
    let cancelDrag=()=>{};
    const openMenu = (event: MouseEvent) => {
      event.preventDefault();event.stopPropagation();cancelDrag();closeMenu();
      const target=this.target || (this.markdownFilePath?{filePath:this.markdownFilePath}:null);
      const remote=this.target?.target;
      closeMenu=openMarkdownCoverMenu(wrapper,{x:event.clientX,y:event.clientY},[
        {label:'保存图片',run:()=>{void saveMarkdownCoverImage(remote?null:imagePath,remote?{url:src,name:this.cover.image.split('/').pop()||'cover.png'}:undefined);}},
        ...(!view.state.readOnly?[
          ...(target?[{label:'重新生成封面',run:()=>{void regenerateMarkdownCoverWithPrompt(target);}}]:[]),
          {label:'删除封面',danger:true,run:()=>deleteCover(view)},
        ]:[]),
      ]);
    };

    const renderLayout=(next:CoverLayout)=>{wrapper.style.height=`${next.displayHeight}px`;resize.setAttribute('aria-valuenow',String(next.displayHeight));img.style.objectPosition=`${next.positionX}% ${next.positionY}%`;};
    const beginDrag=(kind:'position'|'height',event:PointerEvent)=>{
      if(view.state.readOnly)return;
      cancelDrag();
      cancelDrag=beginMarkdownCoverDrag(event,{kind,layout:{displayWidth,displayHeight:parseCssNumber(wrapper.style.height,displayHeight),positionX,positionY:parseCssNumber(img.style.objectPosition.split(/\s+/)[1],positionY)},window:wrapper.ownerDocument.defaultView||window,preview:renderLayout,commit:next=>updateCoverLayout(view,next)});
    };
    resize.setAttribute('role','separator');resize.setAttribute('aria-label','调整封面高度');resize.setAttribute('aria-orientation','horizontal');resize.setAttribute('aria-valuemin','160');resize.setAttribute('aria-valuemax','720');resize.setAttribute('aria-valuenow',String(displayHeight));resize.tabIndex=view.state.readOnly?-1:0;
    resize.addEventListener('keydown',event=>{if(view.state.readOnly||!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();updateCoverLayout(view,{displayHeight:clamp(event.key==='Home'?160:event.key==='End'?720:parseCssNumber(wrapper.style.height,displayHeight)+(event.key==='ArrowUp'?-16:16),160,720,displayHeight)});view.dom.querySelector<HTMLElement>('.cm-markdown-cover-resize')?.focus({preventScroll:true});});
    img.addEventListener('pointerdown', (event) => beginDrag('position', event));
    resize.addEventListener('pointerdown', (event) => beginDrag('height', event));
    wrapper.addEventListener('contextmenu', openMenu);
    wrapper.__hanaMarkdownCoverCleanup = () => {
      closeMenu();
      cancelDrag();
    };

    return wrapper;
  }

  destroy(dom: HTMLElement): void {
    (dom as MarkdownCoverElement).__hanaMarkdownCoverCleanup?.();
  }
}

function buildMarkdownCoverEditorState(state: EditorState): MarkdownCoverEditorState {
  const source = state.doc.toString();
  const cover = parseMarkdownCover(source);
  const range = cover ? findMarkdownCoverRenderRange(source) : null;
  const builder = new RangeSetBuilder<Decoration>();
  if (!cover || !range) {
    return { decorations: builder.finish(), hasTopCover: false };
  }

  const imageContext = state.facet(markdownImageContextFacet);
  const hasTopCover = range.from === 0;
  builder.add(range.from, range.to, Decoration.replace({
    block: true,
    widget: new MarkdownCoverWidget(
      cover,
      imageContext.filePath || undefined,
      imageContext.getFileUrl || undefined,
      hasTopCover,
      state.facet(markdownCoverTargetFacet),
    ),
  }));
  const coverLine = state.doc.lineAt(range.from);
  builder.add(coverLine.from, coverLine.from, coverLineDecoration);

  return { decorations: builder.finish(), hasTopCover };
}

export const markdownCoverField = StateField.define<MarkdownCoverEditorState>({
  create(state) {
    return buildMarkdownCoverEditorState(state);
  },
  update(value, tr) {
    if (tr.docChanged) return buildMarkdownCoverEditorState(tr.state);
    return value;
  },
  provide: field => [
    EditorView.decorations.from(field, value => value.decorations),
    EditorView.editorAttributes.computeN([field], state => (
      state.field(field).hasTopCover ? [{ class: 'cm-markdown-has-top-cover' }] : []
    )),
  ],
});
