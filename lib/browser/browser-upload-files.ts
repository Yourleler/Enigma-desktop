import fs from 'node:fs/promises';
import path from 'node:path';

export async function resolveBrowserUploadFiles({ paths = [], fileIds = [], roots = [], resolveFile, sessionPath, sessionId }: {
  paths?: string[]; fileIds?: string[]; roots?: string[];
  resolveFile?: (id: string, context: any) => any; sessionPath?: string; sessionId?: string;
}) {
  if (paths.length + fileIds.length < 1 || paths.length + fileIds.length > 16) throw new Error('Choose between 1 and 16 files to upload.');
  const allowedRoots: string[] = [];
  for (const root of roots) if (typeof root === 'string' && path.isAbsolute(root)) {
    try { const real = await fs.realpath(root); if ((await fs.stat(real)).isDirectory()) allowedRoots.push(real); } catch {}
  }
  const attachments: string[] = [];
  for (const id of fileIds) {
    if (!resolveFile) throw new Error('Session attachment access is unavailable.');
    const file = await resolveFile(id, {sessionPath,sessionId});
    if (!file?.filePath || file.sessionId && sessionId && file.sessionId !== sessionId || file.sessionPath && sessionPath && file.sessionPath !== sessionPath) throw new Error('This attachment does not belong to the current conversation.');
    attachments.push(await fs.realpath(file.filePath));
  }
  const result: string[] = [];
  for (const source of [...paths,...attachments]) {
    if (typeof source !== 'string' || !path.isAbsolute(source)) throw new Error('Upload requires an absolute path from an authorized folder or a session attachment.');
    const real = await fs.realpath(source);
    if (!attachments.includes(real) && !allowedRoots.some(root => {
      const relative = path.relative(root, real);
      return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    })) throw new Error('Upload file is outside this conversation’s authorized folders. Attach the file or authorize its folder first.');
    if (!(await fs.stat(real)).isFile()) throw new Error('Only regular files can be uploaded.');
    if (!result.includes(real)) result.push(real);
  }
  return result;
}
