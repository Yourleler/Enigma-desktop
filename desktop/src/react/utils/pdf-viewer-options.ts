/** Application policy for the pinned Mozilla generic viewer. */
export function pdfViewerOptions(locale:string,dark:boolean) {
  return {
    defaultUrl:'',disablePreferences:true,disableHistory:true,historyUpdateUrl:false,
    enableScripting:false,isEvalSupported:false,enableAltTextModelDownload:false,enableFakeMLManager:false,
    externalLinkTarget:2,externalLinkRel:'noopener noreferrer',defaultZoomValue:'page-width',
    // This is a preview. Avoid silently losing form/annotation edits when the
    // user switches the preview tab; editing remains in the system application.
    annotationEditorMode:-1,annotationMode:1,
    localeProperties:{lang:locale.startsWith('zh')?'zh-CN':locale||'en-US'},viewerCssTheme:dark?2:1,
  };
}
