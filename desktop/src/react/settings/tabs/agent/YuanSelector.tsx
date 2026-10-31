import React from 'react';
import { t } from '../../helpers';
import {yuanAvatarAsset} from '../../../../../../shared/yuan-visuals';

import './YuanSelector.css';

export function YuanSelector({ currentYuan, onChange }: { currentYuan: string; onChange: (key: string) => void }) {
  const types = t('yuan.types') || {};
  const entries = Object.entries(types) as [string, { label?: string; avatar?: string }][];
  if(!entries.some(([id])=>id==='enigma'))entries.unshift(['enigma',{label:'Enigma',avatar:yuanAvatarAsset('enigma')}]);
  const hIdx = entries.findIndex(([k]) => k === 'hanako');
  if (hIdx >= 0 && entries.length >= 3) {
    const [h] = entries.splice(hIdx, 1);
    entries.splice(1, 0, h);
  }

  const chips = entries.filter(([k]) => k !== 'kong');
  const kongMeta = (types as Record<string, { label?: string }>).kong;

  return (
    <div className="yuan-selector">
      <div className="yuan-chips">
        {chips.map(([key, meta]) => {
          return (
            <button
              key={key}
              data-yuan={key}
              className={`yuan-chip${key === currentYuan ? ' selected' : ''}`}
              type="button"
              aria-pressed={key === currentYuan}
              onClick={() => { if (key !== currentYuan) onChange(key); }}
            >
              <img
                className="yuan-chip-avatar"
                width={32} height={32} alt=""
                src={`assets/${yuanAvatarAsset(key,meta.avatar)}`}
                draggable={false}
              />
              <div className="yuan-chip-info">
                <span className="yuan-chip-name">{key==='enigma'?'Enigma':meta.label||key}</span>
                {key==='enigma'&&<span className="yuan-chip-desc">{t('settings.agent.enigmaStyle')}</span>}
              </div>
            </button>
          );
        })}
      </div>
      {kongMeta && (
        <button
          className={`yuan-kong-banner${currentYuan === 'kong' ? ' selected' : ''}`}
          type="button"
          aria-pressed={currentYuan === 'kong'}
          onClick={() => { if (currentYuan !== 'kong') onChange('kong'); }}
        >
          <span className="yuan-kong-name">{t('yuan.simpleMode')}</span>
          <span className="yuan-kong-desc">{kongMeta.label || ''}</span>
        </button>
      )}
    </div>
  );
}
