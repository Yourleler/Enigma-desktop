import {expect,it} from 'vitest';
import {parseCsvDocument,updateCsvCells} from '../../utils/csv-document';
it('edits one cell without deleting blank rows, extra columns or quoted multiline cells',()=>{
 const source='\uFEFFid,note\r\n001,"two\nlines",extra\r\n\r\n,\r\n002,old\r\n';
 const output=updateCsvCells(source,[{row:4,column:1,value:'edited, "quoted"'}]);const parsed=parseCsvDocument(output);
 expect(parsed.rows).toEqual([['id','note'],['001','two\nlines','extra'],[''],['',''],['002','edited, "quoted"']]);expect(parsed.newline).toBe('\r\n');expect(parsed.bom).toBe(true);expect(parsed.trailing).toBe(true);
});
it('does not add padded cells to shorter rows when the visible blanks were not edited',()=>{
 expect(updateCsvCells('a,b\n1\n2,3,4',[{row:1,column:1,value:''},{row:1,column:2,value:''}])).toBe('a,b\n1\n2,3,4');
});
