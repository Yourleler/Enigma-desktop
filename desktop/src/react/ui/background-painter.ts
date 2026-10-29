import { auroraFragment, auroraVertex } from './aurora-shader';
import { marbleFunction } from './marble-shader';

export type PaintedBackground = 'aurora' | 'marble';
const sceneFragment = `${auroraFragment.replace('void main()', 'void drawAurora()')}
${marbleFunction}
uniform float scene;
void main() {
  if (scene > .5) gl_FragColor = vec4(marbleColor(), 1.0);
  else drawAurora();
}`;

/** The live scene and its picker thumbnail use the exact same renderer. */
export function createBackgroundPainter(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', { alpha:false, antialias:false, depth:false, stencil:false, powerPreference:'low-power' });
  if (!gl) return;
  const shaders: WebGLShader[] = [];
  const program = gl.createProgram(), buffer = gl.createBuffer();
  const dispose = (releaseContext = false) => {
    shaders.forEach(shader => gl.deleteShader(shader)); gl.deleteBuffer(buffer); gl.deleteProgram(program);
    if (releaseContext) gl.getExtension('WEBGL_lose_context')?.loseContext();
  };
  if (!program || !buffer) { dispose(); return; }
  for (const [type,source] of [[gl.VERTEX_SHADER,auroraVertex],[gl.FRAGMENT_SHADER,sceneFragment]] as const) {
    const shader=gl.createShader(type);
    if(!shader){dispose();return;}
    shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){dispose();return;}
    gl.attachShader(program,shader);
  }
  gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS)){dispose();return;}
  gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const position=gl.getAttribLocation(program,'position');
  gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
  const resolution=gl.getUniformLocation(program,'resolution'),time=gl.getUniformLocation(program,'time'),sceneUniform=gl.getUniformLocation(program,'scene');
  return {
    draw(scene: PaintedBackground, width: number, height: number, elapsed: number) {
      if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
      gl.viewport(0,0,width,height);gl.uniform2f(resolution,width,height);gl.uniform1f(time,elapsed);
      gl.uniform1f(sceneUniform,scene==='marble'?1:0);gl.drawArrays(gl.TRIANGLES,0,6);
    },
    dispose,
  };
}

const thumbnails = new Map<PaintedBackground, string | null>();
export function backgroundThumbnail(scene: PaintedBackground) {
  if (thumbnails.has(scene)) return thumbnails.get(scene)!;
  let image: string | null = null;
  // Static fallback also covers test/embedded browsers without WebGL.
  if (typeof WebGLRenderingContext !== 'undefined') {
    const canvas=document.createElement('canvas');
    const painter=createBackgroundPainter(canvas);
    if(painter) {
      try { painter.draw(scene,480,270,18);image=canvas.toDataURL('image/png'); }
      finally { painter.dispose(true); }
    }
  }
  thumbnails.set(scene,image);
  return image;
}
