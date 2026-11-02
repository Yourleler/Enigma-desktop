import {capturePreviewContext} from './preview-context';
import {
  dispatchCoverNotice,
  type MarkdownCoverTargetInput,
  requestMarkdownCoverGeneration,
} from './markdown-cover-generation';

export function isExternalCoverImagePath(imagePath: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(imagePath);
}

function localBasename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1) || 'cover.png';
}

function joinLocalPath(dirPath: string, fileName: string): string {
  const sep = dirPath.includes('\\') && !dirPath.includes('/') ? '\\' : '/';
  return `${dirPath.replace(/[\\/]+$/, '')}${sep}${fileName}`;
}

export async function saveMarkdownCoverImage(imagePath: string | null | undefined, download?: {url:string;name:string}): Promise<void> {
  if(download){
    const owns=capturePreviewContext();
    try{
      const response=await fetch(download.url);
      if(!response.ok)throw Error(`HTTP ${response.status}`);
      const blob=await response.blob();
      if(!owns())return;
      const url=URL.createObjectURL(blob),link=document.createElement('a');
      link.href=url;link.download=download.name;document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),30000);
    }catch(error){if(owns())dispatchCoverNotice(`封面图片下载失败：${error instanceof Error?error.message:String(error)}`,'error');}
    return;
  }
  if (!imagePath || isExternalCoverImagePath(imagePath)) {
    dispatchCoverNotice('当前封面不是本地图片，无法直接保存。', 'error');
    return;
  }
  const owns=capturePreviewContext(),platform=window.platform;
  try{
    const folder=await platform?.selectFolder?.();
    if(!owns()||!folder||!platform?.copyFile)return;
    const ok=await platform.copyFile(imagePath,joinLocalPath(folder,localBasename(imagePath)));
    if(owns())dispatchCoverNotice(ok?'封面图片已保存。':'封面图片保存失败。',ok?'success':'error');
  }catch(error){if(owns())dispatchCoverNotice(`封面图片保存失败：${error instanceof Error?error.message:String(error)}`,'error');}
}

export async function regenerateMarkdownCoverWithPrompt(input: string | null | undefined | MarkdownCoverTargetInput): Promise<void> {
  if (!input) return;
  const owns=capturePreviewContext();
  const targetInput = typeof input === 'string' ? { filePath: input } : input;
  const prompt = window.prompt('这张封面想往哪个方向调整？');
  if (prompt === null) return;
  if(!owns())return;
  try{const result = await requestMarkdownCoverGeneration({
    ...targetInput,
    userGuidance: prompt,
  });
  if(!owns())return;
  // 显式判别收窄：tsconfig.test.json（strictNullChecks: false）的编译闭包自 viewer 入口
  // 测试引入后覆盖到本文件，非严格模式下真值三元不收窄联合，=== false 两种模式都成立。
  if (result.ok === false) {
    dispatchCoverNotice(`封面生成失败：${result.error}`, 'error');
    return;
  }
  dispatchCoverNotice('已提交新的封面生成任务。', 'success');
  }catch(error){if(owns())dispatchCoverNotice(`封面生成失败：${error instanceof Error?error.message:String(error)}`,'error');}
}
