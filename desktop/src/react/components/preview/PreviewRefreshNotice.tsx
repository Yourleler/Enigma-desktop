import {useState} from 'react';
import type {PreviewItem} from '../../types';
import {previewDocumentTargetFromItem,refreshPreviewDocumentTarget} from '../../utils/preview-document-refresh';
import styles from './PreviewSaveNotice.module.css';

export function PreviewRefreshNotice({item}:{item:PreviewItem}){
 const [loading,setLoading]=useState(false),[failure,setFailure]=useState('');
 if(!item.loadError||item.status==='unavailable'||item.status==='missing')return null;
 const target=previewDocumentTargetFromItem(item);
 const retry=async()=>{if(!target)return;setLoading(true);setFailure('');try{await refreshPreviewDocumentTarget(target);}catch(error){setFailure(error instanceof Error?error.message:'重新读取失败，请稍后重试。');}finally{setLoading(false);}};
 return <section className={styles.notice} aria-label="文件刷新状态"><p role="alert">文件刷新未完成，当前内容已保留。</p><details><summary>错误详情</summary><p>{failure||item.loadError}</p></details>{target&&<div className={styles.actions}><button disabled={loading} onClick={()=>void retry()}>{loading?'正在读取…':'重新读取'}</button></div>}</section>;
}
