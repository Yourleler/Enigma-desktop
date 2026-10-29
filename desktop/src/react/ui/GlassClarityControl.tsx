import { useId } from 'react';
import { useMaterialPreferences } from './material-preferences';

export function GlassClarityControl() {
  const id = useId();
  const [material, setMaterial] = useMaterialPreferences();
  return <div className="enigma-glass-clarity">
    <label htmlFor={id}>玻璃清晰度 <output>{material.tint ?? 50}%</output></label>
    <input id={id} type="range" min="0" max="100" step="5" value={material.tint ?? 50} disabled={!material.glass}
      onChange={e => setMaterial({ ...material, tint: Number(e.target.value) })}/>
    <div><span>更通透</span><span>文字更清晰</span></div>
  </div>;
}
