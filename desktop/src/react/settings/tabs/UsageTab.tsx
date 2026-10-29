import {UsageAnalytics} from '../../components/usage/UsageAnalytics';
import {hanaFetch} from '../api';
import {useSettingsStore} from '../store';
import styles from '../Settings.module.css';
import { useState } from 'react';
import { UsageRetention } from './UsageRetention';
export function UsageTab(){
 const [revision,setRevision]=useState(0);
 const connection=useSettingsStore(s=>s.activeServerConnectionId);
 return <div className={`${styles['settings-tab-content']} ${styles.active}`} data-tab="usage"><UsageRetention key={connection || 'local'} connection={connection} onSaved={()=>setRevision(v=>v+1)}/><p>按时间、模型、对话、用途与请求状态查看本地保留的用量记录。</p><UsageAnalytics key={revision} fetcher={hanaFetch} connectionKey={connection}/></div>;
}
