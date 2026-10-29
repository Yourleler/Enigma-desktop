import { EditorView, WidgetType } from '@codemirror/view';
import {parseCsvDocument,updateCsvCells} from '../../utils/csv-document';

export class CsvTableWidget extends WidgetType {
  constructor(
    readonly source: string,
  ) { super(); }

  eq(other: CsvTableWidget) { return this.source === other.source; }

  toDOM(view: EditorView) {
    const wrapper = document.createElement('div');
    wrapper.className = 'cm-csv-table-widget';

    let rows:string[][];try{rows=parseCsvDocument(this.source).rows;}catch{wrapper.textContent='CSV 引号不完整；请选择源码文本修复。';return wrapper;}
    if (rows.length === 0) {
      wrapper.textContent = this.source;
      return wrapper;
    }

    const headers = rows[0];
    const bodyData = rows.slice(1);
    const colCount = Math.max(...rows.map(row=>row.length));

    const table = document.createElement('table');

    // -- thead --
    const thead = document.createElement('thead');
    const headTr = document.createElement('tr');
    Array.from({length:colCount},(_,index)=>headers[index]||'').forEach((h, ci) => {
      const th = document.createElement('th');
      th.textContent = h;
      th.dataset.raw = h;
      th.dataset.row = '-1';
      th.dataset.col = String(ci);
      th.contentEditable = 'true';
      th.spellcheck = false;
      this.bindCell(th, wrapper, view);
      headTr.appendChild(th);
    });
    thead.appendChild(headTr);
    table.appendChild(thead);

    // -- tbody --
    const tbody = document.createElement('tbody');
    bodyData.forEach((row, ri) => {
      const tr = document.createElement('tr');
      for (let ci = 0; ci < colCount; ci++) {
        const td = document.createElement('td');
        const raw = row[ci] ?? '';
        td.textContent = raw;
        td.dataset.raw = raw;
        td.dataset.row = String(ri);
        td.dataset.col = String(ci);
        td.contentEditable = 'true';
        td.spellcheck = false;
        this.bindCell(td, wrapper, view);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrapper.appendChild(table);
    return wrapper;
  }

  /** 给单元格绑定编辑事件 */
  private bindCell(cell: HTMLElement, wrapper: HTMLElement, view: EditorView) {
    cell.addEventListener('focus', () => {
      cell.textContent = cell.dataset.raw || '';
      const sel = window.getSelection();
      if (sel) {
        const range = document.createRange();
        range.selectNodeContents(cell);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });

    cell.addEventListener('blur', () => {
      const newRaw = cell.textContent || '';
      if (newRaw === cell.dataset.raw) return;
      cell.dataset.raw = newRaw;
      this.syncToDocument(wrapper, view);
    });

    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cell.textContent = cell.dataset.raw || '';
        view.focus();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        cell.blur();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const next = e.shiftKey
          ? this.adjacentCell(cell, wrapper, -1)
          : this.adjacentCell(cell, wrapper, 1);
        if (next) {
          cell.blur();
          next.focus();
        } else {
          cell.blur();
          view.focus();
        }
      }
    });
  }

  private adjacentCell(current: HTMLElement, wrapper: HTMLElement, dir: number): HTMLElement | null {
    const cells = Array.from(wrapper.querySelectorAll<HTMLElement>('th, td'));
    const idx = cells.indexOf(current);
    if (idx === -1) return null;
    return cells[idx + dir] ?? null;
  }

  /** 从 DOM 读取所有单元格，重建 CSV，写回文档 */
  private syncToDocument(wrapper: HTMLElement, view: EditorView) {
    const edits=Array.from(wrapper.querySelectorAll<HTMLElement>('th,td')).map(cell=>({row:Number(cell.dataset.row)+1,column:Number(cell.dataset.col),value:cell.dataset.raw||''}));
    const newCsv=updateCsvCells(this.source,edits);

    if (newCsv === this.source) return;

    // 整个文档就是 CSV，替换全部内容
    const docLen = view.state.doc.length;
    view.dispatch({ changes: { from: 0, to: docLen, insert: newCsv } });
  }

  ignoreEvent() { return true; }
}
