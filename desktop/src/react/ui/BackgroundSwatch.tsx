import { useEffect, useState } from 'react';
import { backgroundThumbnail } from './background-painter';

export function BackgroundSwatch({ scene }: { scene: 'aurora' | 'halo' | 'ribbon' | 'marble' | 'solid-dark' | 'solid-light' }) {
  const [image,setImage]=useState<string|null>(null);
  useEffect(()=>{setImage(scene==='aurora'||scene==='marble'?backgroundThumbnail(scene):null);},[scene]);
  return <span className="enigma-background-swatch" data-background-swatch={scene} aria-hidden="true">
    {image && <img src={image} alt="" data-background-thumbnail={scene}/>}
  </span>;
}
