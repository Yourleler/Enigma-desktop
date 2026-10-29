import fs from 'node:fs/promises';
import path from 'node:path';
/** Original local fixtures for pan, original-size, small-image and failure checks. */
export async function createImagePreviewFixtures(root){
 for(const [name,width,height,color] of [['image-first.svg',1600,1000,'#7d55b5'],['image-wide.svg',2800,700,'#24766b'],['image-small.svg',160,120,'#ae5470']]){
  const grid=Array.from({length:Math.floor(width/100)+1},(_,i)=>`<path d="M ${i*100} 0 V ${height}" stroke="#ffffff40"/>`).join('')+Array.from({length:Math.floor(height/100)+1},(_,i)=>`<path d="M 0 ${i*100} H ${width}" stroke="#ffffff40"/>`).join('');
  const font=Math.min(28,width/12);
  await fs.writeFile(path.join(root,name),`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/>${grid}<circle cx="${width/2}" cy="${height/2}" r="${Math.min(width,height)*.2}" fill="#d9c5f7"/><text x="${width/2}" y="${height/2}" text-anchor="middle" font-size="${font}" fill="#222">${name}</text></svg>`,{flag:'wx'});
 }
 await fs.writeFile(path.join(root,'broken-image.svg'),'not an SVG',{flag:'wx'});
}
if(process.argv[2])await createImagePreviewFixtures(path.resolve(process.argv[2]));
