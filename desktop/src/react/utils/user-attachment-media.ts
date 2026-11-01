import type { UserAttachment } from '../stores/chat-types';
import type { PlatformApi } from '../types';
import {useEffect, useState} from 'react';
import {useStore} from '../stores';

type FileUrlPlatform = Pick<PlatformApi, 'getFileUrl'> | null | undefined;

export function getUserAttachmentImageSrc(
  attachment: Pick<UserAttachment, 'path' | 'base64Data' | 'mimeType'>,
  platform: FileUrlPlatform = typeof window !== 'undefined' ? window.platform : undefined,
): string | null {
  if (attachment.base64Data) {
    return `data:${attachment.mimeType || 'image/png'};base64,${attachment.base64Data}`;
  }
  if (attachment.path && typeof platform?.getFileUrl === 'function') {
    return platform.getFileUrl(attachment.path);
  }
  return null;
}

/** Web cannot use native file URLs. Read registered images through its existing
 * authenticated file bridge, discarding late results after a file change. */
export function useUserAttachmentImageSrc(attachment: UserAttachment, enabled = true): string | null {
  const connection = useStore(state => state.activeServerConnectionId || 'local');
  const source = getUserAttachmentImageSrc(attachment);
  const key = `${connection}:${attachment.path}:${attachment.mimeType || 'image/png'}`;
  const [loaded, setLoaded] = useState<{key:string; src:string} | null>(null);
  useEffect(() => {
    let active = true;
    if (enabled && attachment.status !== 'expired' && !source && attachment.path && window.platform?.readFileBase64) {
      void window.platform.readFileBase64(attachment.path).then(data => {
        if (active && data) setLoaded({key,src:`data:${attachment.mimeType || 'image/png'};base64,${data}`});
      }).catch(() => {});
    }
    return () => { active = false; };
  }, [attachment.path, attachment.mimeType, attachment.status, enabled, key, source]);
  return !enabled || attachment.status === 'expired' ? null : source || (loaded?.key === key ? loaded.src : null);
}
