declare module 'pdfjs-dist/web/pdf_viewer.mjs' {
  export * from 'pdfjs-dist/types/web/pdf_viewer.component';
}

declare module 'pdfjs-dist/build/pdf.worker.mjs?worker' {
  const WorkerModule: new () => Worker;
  export default WorkerModule;
}
declare module 'pdfjs-dist/web/pdf_viewer.css?inline' {
  const css: string;
  export default css;
}
