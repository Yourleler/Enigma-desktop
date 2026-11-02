import {createPortal} from 'react-dom';
import {ResourceMentionPicker,type ResourceMention} from './ResourceMentionPicker';
import { GlassSelection } from '../../ui/GlassSelection';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Agent } from '../../types';
import type { FileMentionItem } from '../../utils/file-mention-items';
import type { AgentMentionItem, MentionTab, SessionMentionItem } from '../../utils/mention-items';
import { kindOfFileName } from '../../utils/file-kind';
import { AgentAvatar, resolveAgentDisplayInfo } from '../../utils/agent-display';
import { FileKindIcon } from '../shared/FileKindIcon';
import { FolderIcon } from '../shared/FolderIcon';
import styles from './InputArea.module.css';

export type MentionMenuItem = FileMentionItem | SessionMentionItem | AgentMentionItem | ResourceMention;

export const MentionMenu = memo(function MentionMenu({
  tab,
  query = '',
  items,
  selected,
  busy,
  agents,
  onTabChange,
  onSelect,
  onHover,
  onClose,
}: {
  tab: MentionTab;
  query?:string;
  items: MentionMenuItem[];
  selected: number;
  busy: boolean;
  agents: Agent[];
  onTabChange: (tab: MentionTab) => void;
  onSelect: (item: MentionMenuItem) => void;
  onHover: (index: number) => void;
  onClose?:()=>void;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  const menuRef=useRef<HTMLDivElement>(null);
  const [position,setPosition]=useState({left:12,top:12,maxHeight:320});
  useLayoutEffect(()=>{const place=()=>{const editor=document.getElementById('inputBox');if(!editor)return;const anchor=editor.closest('[data-liquid="composer"]')||editor;const box=anchor.getBoundingClientRect();const maxHeight=Math.min(320,Math.max(100,box.top-20));const height=Math.min(menuRef.current?.getBoundingClientRect().height||maxHeight,maxHeight);setPosition({left:Math.max(12,Math.min(box.left,window.innerWidth-392)),top:Math.max(12,box.top-height-8),maxHeight});};place();const observer=new ResizeObserver(place);if(menuRef.current)observer.observe(menuRef.current);window.addEventListener('resize',place);window.addEventListener('scroll',place,true);return()=>{observer.disconnect();window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};},[]);
  const t = window.t ?? ((key: string) => key);

  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selected]);

  return createPortal(
    <div ref={menuRef} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose?.();document.getElementById('inputBox')?.focus();}}} data-composer-mention="" style={position} className={styles['mention-menu']} data-liquid="menu" data-menu-surface="" data-menu-position="fixed" role="dialog" aria-label={t('input.mention.title')}>
      <div className={styles['mention-tabs']} role="tablist" data-glass-segmented=""><GlassSelection selection={tab}/>
        {(['repositories', 'branches', 'files', 'github', 'sessions', 'agents'] as MentionTab[]).map(value => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={`${styles['mention-tab']}${tab === value ? ` ${styles.selected}` : ''}`}
            onMouseDown={(event) => {
              event.preventDefault();
              onTabChange(value);
            }}
          >
            {({repositories:'仓库',branches:'分支',github:'GitHub'} as Record<string,string>)[value]||t(`input.mention.tab.${value}`)}
          </button>
        ))}
      </div>
      {tab==='repositories'||tab==='branches'||tab==='github'?<ResourceMentionPicker kind={tab} query={query} onSelect={onSelect}/>:<div className={styles['mention-results']} role="listbox">
        {items.map((item, index) => (
          <MentionItemButton
            key={item.id}
            item={item}
            agents={agents}
            selected={index === selected}
            refProp={index === selected ? selectedRef : undefined}
            onHover={() => onHover(index)}
            onSelect={() => onSelect(item)}
          />
        ))}
        {items.length === 0 && (
          <div className={styles['mention-empty']}>
            {busy ? t('common.loading') : t('input.mention.empty')}
          </div>
        )}
      </div>}
    </div>,document.body
  );
});

function MentionItemButton({
  item,
  agents,
  selected,
  refProp,
  onHover,
  onSelect,
}: {
  item: MentionMenuItem;
  agents: Agent[];
  selected: boolean;
  refProp?: RefObject<HTMLButtonElement | null>;
  onHover: () => void;
  onSelect: () => void;
}) {
  return (
    <button
      ref={refProp}
      type="button"
      role="option"
      aria-selected={selected}
      data-menu-row=""
      className={`${styles['mention-item']}${selected ? ` ${styles.selected}` : ''}`}
      onMouseEnter={onHover}
      onMouseDown={(event) => {
        event.preventDefault();
        onSelect();
      }}
    >
      <span className={styles['mention-icon']} aria-hidden="true">
        <MentionItemIcon item={item} agents={agents} />
      </span>
      <span className={styles['mention-main']}>
        <span className={styles['mention-name']}>{item.name}</span>
        {item.detail&&item.detail!=='/'&&<span className={styles['mention-detail']}>{item.detail}</span>}
      </span>
    </button>
  );
}

function MentionItemIcon({ item, agents }: { item: MentionMenuItem; agents: Agent[] }) {
  const agentInfo = useMemo(() => {
    if (!('kind' in item) || item.kind !== 'agent') return null;
    return resolveAgentDisplayInfo({ id: item.agentId, agents, fallbackAgentName: item.name, fallbackAgentYuan: item.yuan });
  }, [agents, item]);

  if ('kind' in item && item.kind === 'agent' && agentInfo) {
    return <AgentAvatar info={agentInfo} className={styles['mention-agent-avatar']} alt="" />;
  }
  if ('kind' in item && item.kind === 'session') {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
        <rect x="4" y="3" width="16" height="18" rx="1" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </svg>
    );
  }

  const file = item as FileMentionItem;
  const fileKind = kindOfFileName(file.name || file.path, file.mimeType);
  const thumbnailUrl = !file.isDirectory && (fileKind === 'image' || fileKind === 'svg') && file.path
    ? window.platform?.getFileUrl?.(file.path)
    : null;
  if (thumbnailUrl) return <img className={styles['mention-thumbnail']} src={thumbnailUrl} alt="" />;
  if (file.isDirectory) return <FolderIcon size={18} />;
  return <FileKindIcon kind={fileKind} size={18} />;
}
