import { CFG } from '../config';
import { compile, createTarget, deleteTarget, probeHdr, uniforms, type Target, type Uniforms } from './gl';
import { BG_FS, COMP_FS, DOWN_FS, FS_VS, SH, SPRITE_FS, SPRITE_VS, UP_FS } from './shaders';
import { CELL_EM_H, CELL_EM_W, GlyphAtlas, TextBuf } from './text';

const FLOATS = 18;
const CAPACITY = 24000;

export interface FrameParams {
  time: number;
  camX: number;
  camY: number;
  zoom: number;
  bg0: Float32Array; bg1: Float32Array; bg2: Float32Array; bg3: Float32Array;
  darkRim: Float32Array;
  prism: number;
  beat: number;
  parX: number;
  parY: number;
  flash: number;
  flashCol: Float32Array;
  ca: number;
  breath: number;
  desat: number;
  vignette: number;
  grain: number;
  bloom: number;
  highContrast: number;
}

/**
 * WebGL2 renderer: background shader → instanced SDF sprites (HDR) → multi-pass bloom → composite.
 * All per-frame work writes into preallocated typed arrays: zero allocations while playing.
 */
export class Renderer {
  gl!: WebGL2RenderingContext;
  ok = false;
  lost = false;
  hdr = true;
  private encode = 1;
  private data = new Float32Array(CAPACITY * FLOATS);
  count = 0;

  private sprite!: WebGLProgram; private su!: Uniforms;
  private bg!: WebGLProgram; private bu!: Uniforms;
  private down!: WebGLProgram; private du!: Uniforms;
  private up!: WebGLProgram; private uu!: Uniforms;
  private comp!: WebGLProgram; private cu!: Uniforms;
  private vao!: WebGLVertexArrayObject;
  private fsVao!: WebGLVertexArrayObject;
  private instBuf!: WebGLBuffer;
  private atlasTex!: WebGLTexture;
  private scene: Target | null = null;
  private mips: Target[] = [];
  bloomLevels = 6;

  /** device pixels */
  pw = 1;
  ph = 1;
  /** css pixels */
  cw = 1;
  ch = 1;
  dpr = 1;
  /** css px per world unit */
  scale = 1;
  /** visible half extents in world units */
  halfW = 500;
  halfH = 500;

  constructor(readonly canvas: HTMLCanvasElement, readonly atlas: GlyphAtlas) {}

  init(): boolean {
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) return false;
    this.gl = gl;
    try {
      // wide gamut on P3 displays (S24 Ultra AMOLED, iPad Liquid Retina)
      const g = gl as WebGL2RenderingContext & { drawingBufferColorSpace?: string };
      if ('drawingBufferColorSpace' in g && matchMedia('(color-gamut: p3)').matches) g.drawingBufferColorSpace = 'display-p3';
    } catch { /* ignore */ }
    this.hdr = probeHdr(gl);
    this.encode = this.hdr ? 1 : 0.25;

    this.sprite = compile(gl, SPRITE_VS, SPRITE_FS); this.su = uniforms(gl, this.sprite);
    this.bg = compile(gl, FS_VS, BG_FS); this.bu = uniforms(gl, this.bg);
    this.down = compile(gl, FS_VS, DOWN_FS); this.du = uniforms(gl, this.down);
    this.up = compile(gl, FS_VS, UP_FS); this.uu = uniforms(gl, this.up);
    this.comp = compile(gl, FS_VS, COMP_FS); this.cu = uniforms(gl, this.comp);

    // quad corners + instance buffer
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.instBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const stride = FLOATS * 4;
    const attr = (loc: number, size: number, off: number): void => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, off * 4);
      gl.vertexAttribDivisor(loc, 1);
    };
    attr(1, 4, 0);
    attr(2, 2, 4);
    attr(3, 4, 6);
    attr(4, 4, 10);
    attr(5, 4, 14);
    gl.bindVertexArray(null);
    this.fsVao = gl.createVertexArray()!;

    // glyph atlas
    this.atlasTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.atlas.canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.scene = null;
    this.mips = [];
    this.ok = true;
    this.lost = false;
    this.allocTargets();
    return true;
  }

  /** css size + device pixel ratio. The short side always spans CFG.world.shortSide world units. */
  resize(cssW: number, cssH: number, dpr: number, pixelW?: number, pixelH?: number): void {
    this.cw = Math.max(1, cssW);
    this.ch = Math.max(1, cssH);
    this.dpr = dpr;
    this.pw = Math.max(1, pixelW ?? Math.round(this.cw * dpr));
    this.ph = Math.max(1, pixelH ?? Math.round(this.ch * dpr));
    this.scale = Math.min(this.cw, this.ch) / CFG.world.shortSide;
    this.halfW = this.cw / 2 / this.scale;
    this.halfH = this.ch / 2 / this.scale;
    if (this.canvas.width !== this.pw || this.canvas.height !== this.ph) {
      this.canvas.width = this.pw;
      this.canvas.height = this.ph;
    }
    if (this.ok && !this.lost) this.allocTargets();
  }

  private allocTargets(): void {
    const gl = this.gl;
    if (this.scene && this.scene.w === this.pw && this.scene.h === this.ph && this.mips.length === this.bloomLevels) return;
    deleteTarget(gl, this.scene);
    for (const m of this.mips) deleteTarget(gl, m);
    this.mips = [];
    this.scene = createTarget(gl, this.pw, this.ph, this.hdr);
    let w = this.pw, h = this.ph;
    for (let i = 0; i < this.bloomLevels; i++) {
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
      this.mips.push(createTarget(gl, w, h, this.hdr));
    }
  }

  setBloomLevels(n: number): void {
    if (n === this.bloomLevels) return;
    this.bloomLevels = n;
    if (this.ok && !this.lost) {
      deleteTarget(this.gl, this.scene);
      this.scene = null;
      this.allocTargets();
    }
  }

  // ------------------------------------------------------------------ emit

  begin(): void {
    this.count = 0;
  }

  /** Raw instance push. All shapes go through here. */
  push(
    shape: number, x: number, y: number, rot: number, hw: number, hh: number,
    ar: number, ag: number, ab: number, aa: number,
    br: number, bg: number, bb: number, ba: number,
    p0: number, p1: number, p2: number, p3: number,
  ): void {
    if (this.count >= CAPACITY) return;
    const d = this.data, o = this.count * FLOATS;
    d[o] = x; d[o + 1] = y; d[o + 2] = rot; d[o + 3] = shape;
    d[o + 4] = hw; d[o + 5] = hh;
    d[o + 6] = ar; d[o + 7] = ag; d[o + 8] = ab; d[o + 9] = aa;
    d[o + 10] = br; d[o + 11] = bg; d[o + 12] = bb; d[o + 13] = ba;
    d[o + 14] = p0; d[o + 15] = p1; d[o + 16] = p2; d[o + 17] = p3;
    this.count++;
  }

  glow(x: number, y: number, r: number, cr: number, cg: number, cb: number, a: number): void {
    this.push(SH.GLOW, x, y, 0, r, r, cr, cg, cb, a, 0, 0, 0, 0, 0, 0, 0, 0);
  }

  seg(
    ax: number, ay: number, bx: number, by: number, r: number,
    cr: number, cg: number, cb: number, ca: number,
    gr: number, gg: number, gb: number, ga: number, glowR: number, dash = 0,
  ): void {
    const dx = bx - ax, dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy);
    const m = r + glowR * 3;
    this.push(SH.SEG, (ax + bx) * 0.5, (ay + by) * 0.5, Math.atan2(dy, dx), len * 0.5 + m, m,
      cr, cg, cb, ca, gr, gg, gb, ga, len * 0.5, r, glowR, dash);
  }

  /** Measure text width (world units) for a given em size. */
  measure(t: TextBuf, size: number, tracking = 0.02): number {
    let w = 0;
    for (let i = 0; i < t.len; i++) {
      const g = t.codes[i] === 32 ? this.atlas.space : this.atlas.get(t.codes[i]);
      if (g) w += (g.adv + tracking) * size;
    }
    return w - tracking * size;
  }

  /**
   * Text as glyph instances. align: 0 = center, -1 = left, 1 = right.
   * Glyphs scale in from `pop` (0..1) for juicy reveals.
   */
  text(
    t: TextBuf, x: number, y: number, size: number, align: number,
    r: number, g: number, b: number, a: number,
    gr: number, gg: number, gb: number, ga: number,
    tracking = 0.02, rot = 0,
  ): void {
    const w = this.measure(t, size, tracking);
    let cx = align === 0 ? -w / 2 : align < 0 ? 0 : -w;
    const c = Math.cos(rot), s = Math.sin(rot);
    const hw = CELL_EM_W * size * 0.5, hh = CELL_EM_H * size * 0.5;
    for (let i = 0; i < t.len; i++) {
      const code = t.codes[i];
      const gl = code === 32 ? this.atlas.space : this.atlas.get(code);
      if (!gl) continue;
      const adv = gl.adv * size;
      if (code !== 32) {
        const lx = cx + adv / 2;
        this.push(SH.GLYPH, x + lx * c, y + lx * s, rot, hw, hh, r, g, b, a, gr, gg, gb, ga, gl.u0, gl.v0, gl.u1, gl.v1);
      }
      cx += adv + tracking * size;
    }
  }

  icon(code: number, x: number, y: number, size: number, r: number, g: number, b: number, a: number, rot = 0): void {
    const gl = this.atlas.get(code);
    if (!gl) return;
    const hw = CELL_EM_W * size * 0.5, hh = CELL_EM_H * size * 0.5;
    this.push(SH.GLYPH, x, y, rot, hw, hh, r, g, b, a, r, g, b, a * 0.6, gl.u0, gl.v0, gl.u1, gl.v1);
  }

  // ------------------------------------------------------------------ frame

  end(f: FrameParams): void {
    if (!this.ok || this.lost) return;
    const gl = this.gl;
    const scene = this.scene!;

    // 1) background
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.fb);
    gl.viewport(0, 0, scene.w, scene.h);
    gl.disable(gl.BLEND);
    gl.useProgram(this.bg);
    const bu = this.bu;
    gl.uniform2f(bu.u_res, scene.w, scene.h);
    gl.uniform1f(bu.u_time, f.time);
    gl.uniform3f(bu.u_c0, f.bg0[0], f.bg0[1], f.bg0[2]);
    gl.uniform3f(bu.u_c1, f.bg1[0], f.bg1[1], f.bg1[2]);
    gl.uniform3f(bu.u_c2, f.bg2[0], f.bg2[1], f.bg2[2]);
    gl.uniform3f(bu.u_c3, f.bg3[0], f.bg3[1], f.bg3[2]);
    gl.uniform1f(bu.u_prism, f.prism);
    gl.uniform2f(bu.u_par, f.parX, f.parY);
    gl.uniform1f(bu.u_beat, f.beat);
    gl.uniform1f(bu.u_hc, f.highContrast);
    gl.uniform1f(bu.u_encode, this.encode);
    const sh = Math.min(this.cw, this.ch);
    gl.uniform1f(bu.u_aspect, this.cw / sh);
    gl.uniform1f(bu.u_aspectY, this.ch / sh);
    gl.bindVertexArray(this.fsVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2) sprites
    if (this.count > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.sprite);
      const su = this.su;
      const z = f.zoom;
      gl.uniform4f(su.u_view, (2 * this.scale * z) / this.cw, (-2 * this.scale * z) / this.ch, -f.camX, -f.camY);
      gl.uniform1f(su.u_px, 1 / (this.scale * z * this.dpr));
      gl.uniform1f(su.u_time, f.time);
      gl.uniform3f(su.u_darkRim, f.darkRim[0], f.darkRim[1], f.darkRim[2]);
      gl.uniform1f(su.u_hc, f.highContrast);
      gl.uniform1f(su.u_encode, this.encode);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
      gl.uniform1i(su.u_atlas, 0);
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * FLOATS);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    }

    // 3) bloom: threshold + downsample chain
    gl.disable(gl.BLEND);
    gl.useProgram(this.down);
    gl.bindVertexArray(this.fsVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.du.u_src, 0);
    let src: Target = scene;
    for (let i = 0; i < this.mips.length; i++) {
      const dst = this.mips[i];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      gl.viewport(0, 0, dst.w, dst.h);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform2f(this.du.u_texel, 1 / src.w, 1 / src.h);
      gl.uniform1f(this.du.u_threshold, i === 0 ? 1.15 : -1);
      gl.uniform1f(this.du.u_decode, 1 / this.encode);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = dst;
    }
    // upsample + accumulate
    gl.useProgram(this.up);
    gl.uniform1i(this.uu.u_src, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = this.mips.length - 1; i > 0; i--) {
      const s = this.mips[i], d = this.mips[i - 1];
      gl.bindFramebuffer(gl.FRAMEBUFFER, d.fb);
      gl.viewport(0, 0, d.w, d.h);
      gl.bindTexture(gl.TEXTURE_2D, s.tex);
      gl.uniform2f(this.uu.u_texel, 1 / s.w, 1 / s.h);
      gl.uniform1f(this.uu.u_radius, 1.0);
      gl.uniform1f(this.uu.u_weight, 0.92);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.disable(gl.BLEND);

    // 4) composite to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.pw, this.ph);
    gl.useProgram(this.comp);
    const cu = this.cu;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.tex);
    gl.uniform1i(cu.u_scene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.mips[0].tex);
    gl.uniform1i(cu.u_bloom, 1);
    gl.uniform1f(cu.u_bloomStr, f.bloom);
    gl.uniform1f(cu.u_ca, f.ca);
    gl.uniform1f(cu.u_flash, f.flash);
    gl.uniform3f(cu.u_flashCol, f.flashCol[0], f.flashCol[1], f.flashCol[2]);
    gl.uniform1f(cu.u_vignette, f.vignette);
    gl.uniform1f(cu.u_grain, f.grain);
    gl.uniform1f(cu.u_time, f.time);
    gl.uniform1f(cu.u_breath, f.breath);
    gl.uniform1f(cu.u_desat, f.desat);
    gl.uniform1f(cu.u_decode, 1 / this.encode);
    gl.uniform2f(cu.u_aspect, this.cw / sh, this.ch / sh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }
}
