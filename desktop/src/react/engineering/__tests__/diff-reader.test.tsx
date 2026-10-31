// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {cleanup, render, screen} from '@testing-library/react';
import {afterEach, expect, it} from 'vitest';
import {DiffReader} from '../DiffReader';
afterEach(cleanup);
it('does not offer text controls or a stale chunk count when the body was not retained',()=>{
  render(<DiffReader version="v" change={{repo:'r',file:'large.txt',change:'added',after:{size:520000,omitted:'文件超过512KB，仅保留变化标记'}}}/>);
  expect(screen.getByText(/520,000 字节/)).toBeVisible();
  expect(screen.queryByRole('button',{name:'展开全文'})).toBeNull();
  expect(screen.queryByRole('button',{name:'查找'})).toBeNull();
  expect(screen.queryByText(/\d+ 处/)).toBeNull();
});
it('shows rename origins and unknown authorship independently of the file-list width',()=>{
  render(<DiffReader version="v" change={{repo:'r',file:'new.bin',previousPath:'old.bin',change:'renamed',attribution:'unattributed',before:{size:3,omitted:'二进制文件'},after:{size:3,omitted:'二进制文件'}}}/>);
  expect(screen.getByText('old.bin → new.bin')).toBeVisible();
  expect(screen.getByText(/不代表由助手写入/)).toBeVisible();
});
