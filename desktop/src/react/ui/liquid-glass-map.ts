/** Rounded-rectangle signed distance / inward normal displacement map.
 * Inspired by the technique documented at childrentime/liquid-glass;
 * implemented here with a bounded edge band and a neutral, undistorted center. */
export function createGlassMap(width: number, height: number, radius = 16, maxDimension = 320, edgeBand = 18) {
  const ratio = Math.min(1, maxDimension / Math.max(width,height));
  const w=Math.max(2,Math.round(width*ratio)), h=Math.max(2,Math.round(height*ratio));
  const r=Math.min(radius,width/2,height/2)*ratio, band=Math.min(edgeBand*ratio,w/3,h/3);
  const pixels=new Uint8ClampedArray(w*h*4);
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const px=x+.5-w/2,py=y+.5-h/2;
    const qx=Math.abs(px)-(w/2-r),qy=Math.abs(py)-(h/2-r);
    const ox=Math.max(qx,0),oy=Math.max(qy,0),length=Math.hypot(ox,oy);
    const distance=Math.min(Math.max(qx,qy),0)+length-r;
    let nx=0,ny=0;
    if(length>0){nx=ox/length*Math.sign(px);ny=oy/length*Math.sign(py);}
    else if(qx>qy)nx=Math.sign(px);else ny=Math.sign(py);
    const t=Math.max(0,Math.min(1,-distance/Math.max(1,band)));
    // Bell-shaped edge refraction returns smoothly to neutral on either side.
    const strength=distance<=0?Math.sin(Math.PI*t)**2:0;
    const i=(y*w+x)*4;
    pixels[i]=Math.round(128-nx*strength*115);
    pixels[i+1]=Math.round(128-ny*strength*115);
    pixels[i+2]=128;pixels[i+3]=255;
  }
  return {width:w,height:h,pixels};
}
