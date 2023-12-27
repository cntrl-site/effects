import { EffectRenderer } from './types/EffectRenderer';

const vertexShader2d = `
attribute vec2 a_position;
attribute vec2 a_texCoord;

uniform vec2 u_resolution;

varying vec2 v_texCoord;

void main() {
  // convert the rectangle from pixels to 0.0 to 1.0
  vec2 zeroToOne = a_position / u_resolution;

  // convert from 0->1 to 0->2
  vec2 zeroToTwo = zeroToOne * 2.0;

  // convert from 0->2 to -1->+1 (clipspace)
  vec2 clipSpace = zeroToTwo - 1.0;

  gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);

  // pass the texCoord to the fragment shader
  // The GPU will interpolate this value between points.
  v_texCoord = a_texCoord;
}`;

const defaultShader = `
precision mediump float;

// our texture
uniform sampler2D u_image;
uniform sampler2D u_pattern;
uniform float u_time;
uniform vec2 u_imgDimensions;
uniform vec2 u_patternDimensions;

// the texCoords passed in from the vertex shader.
varying vec2 v_texCoord;

void main() {
  float tunedTime = u_time * 1.0;
  gl_FragColor = texture2D(u_image, v_texCoord);
}`;

interface ImageFxParams {
  time: number;
  cursor: [number, number]; // user's cursor relative to the image
}

type FxCache = {
  program?: WebGLProgram;
  texture?: WebGLTexture;
  patternTexture?: WebGLTexture;
  positionBuffer?: WebGLBuffer;
  texCoordBuffer?: WebGLBuffer;
};

export class ImageEffect implements EffectRenderer {
  private image: HTMLImageElement;
  private pattern: HTMLImageElement;
  private vpWidth: number = 100;
  private vpHeight: number = 100;
  private fxParams: ImageFxParams;
  private cache: WeakMap<WebGL2RenderingContext, FxCache> = new WeakMap();
  private fragmentShaderSrc: string;

  constructor(
    url: string,
    patternUrl: string,
    fragmentShaderSrc: string,
    params: ImageFxParams
  ) {
    this.image = new Image();
    this.image.crossOrigin = 'anonymous';
    this.image.src = url;
    this.pattern = new Image();
    this.pattern.crossOrigin = 'anonymous';
    this.pattern.src = patternUrl;
    this.fxParams = { ...params };
    this.fragmentShaderSrc = fragmentShaderSrc ? fragmentShaderSrc : defaultShader;
  }

  setViewport(width: number, height: number): void {
    this.vpWidth = width;
    this.vpHeight = height;
  }

  setParam<T extends keyof ImageFxParams>(
    name: T,
    value: ImageFxParams[T]
  ): void {
    this.fxParams[name] = value;
  }

  ready(): boolean {
    return this.image.complete;
  }

  prepare(gl: WebGL2RenderingContext): void {
    this.ensureCache(gl);
  }

  render(gl: WebGL2RenderingContext): void {
    if (!this.ready()) return;
    this.ensureCache(gl);
    const program = this.cacheGet(gl, 'program')!;
    const posBuffer = this.cacheGet(gl, 'positionBuffer')!;
    const texBuffer = this.cacheGet(gl, 'texCoordBuffer')!;
    const texture = this.cacheGet(gl, 'texture')!;
    const patternTexture = this.cacheGet(gl, 'patternTexture')!;
    gl.viewport(0, 0, this.vpWidth, this.vpHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.setupPosition(gl);
    gl.useProgram(program);
    // shader prop: a_position
    const posLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer)
    gl.vertexAttribPointer(
      posLocation,
      2,
      gl.FLOAT,
      false,
      0,
      0
    );
    // shader prop: a_texCoord
    const texLocation = gl.getAttribLocation(program, 'a_texCoord');
    gl.enableVertexAttribArray(texLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, texBuffer);
    gl.vertexAttribPointer(
      texLocation,
      2,
      gl.FLOAT,
      false,
      0,
      0
    );
    // shader prop: u_resolution
    const resLocation = gl.getUniformLocation(program, 'u_resolution');
    gl.uniform2f(resLocation, this.vpWidth, this.vpHeight);
    // shader prop: u_cursor
    const cursorLocation = gl.getUniformLocation(program, 'u_cursor');
    gl.uniform2f(cursorLocation, this.fxParams.cursor[0], this.fxParams.cursor[1]);
    // shader prop: u_time
    const timeLocation = gl.getUniformLocation(program, 'u_time');
    gl.uniform1f(timeLocation, this.fxParams.time);
    // img + dimensions
    const imageLocation = gl.getUniformLocation(program, 'u_image');
    const dimensionsLocation = gl.getUniformLocation(program, 'u_imgDimensions');
    gl.uniform2f(dimensionsLocation, this.image.width, this.image.height);
    // pattern + dimensions
    const patternLocation = gl.getUniformLocation(program, 'u_pattern');
    const patternDimensionsLocation = gl.getUniformLocation(program, 'u_patternDimensions');
    gl.uniform2f(patternDimensionsLocation, this.pattern.width, this.pattern.height);
    gl.uniform1i(imageLocation, 0);
    gl.uniform1i(patternLocation, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, patternTexture);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private setupPosition(gl: WebGL2RenderingContext): void {
    const posBuffer = this.cacheGet(gl, 'positionBuffer')!;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    const imgAspectRatio = this.image.width / this.image.height;
    const itemAspectRatio = this.vpWidth / this.vpHeight;
    const rw = itemAspectRatio < imgAspectRatio ? this.vpHeight * imgAspectRatio : this.vpWidth;
    const rh = itemAspectRatio < imgAspectRatio ? this.vpHeight : this.vpWidth / imgAspectRatio;
    const x1 = (this.vpWidth - rw) / 2;
    const y1 = (this.vpHeight - rh) / 2;
    const x2 = x1 + rw;
    const y2 = y1 + rh;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      x1, y1,
      x2, y1,
      x1, y2,
      x1, y2,
      x2, y1,
      x2, y2,
    ]), gl.STATIC_DRAW);
  }

  private ensureCache(gl: WebGL2RenderingContext): void {
    if (!this.cacheGet(gl, 'program')) {
      this.compileProgram(gl);
    }
    if (!this.cacheGet(gl, 'positionBuffer')) {
      this.createPositionBuffer(gl);
    }
    if (!this.cacheGet(gl, 'texCoordBuffer')) {
      this.createTexCoordBuffer(gl);
    }
    if (!this.cacheGet(gl, 'texture')) {
      this.loadTexture(gl, this.image, 'texture');
    }
    if (!this.cacheGet(gl, 'patternTexture')) {
      this.loadTexture(gl, this.pattern, 'patternTexture', gl.NEAREST);
    }
  }

  private cacheGet<T extends keyof FxCache>(
    gl: WebGL2RenderingContext,
    param: T
  ): FxCache[T] | undefined {
    return this.cache.get(gl)?.[param];
  }

  private cacheSet<T extends keyof FxCache>(
    gl: WebGL2RenderingContext,
    param: T,
    value?: FxCache[T]
  ): void {
    const record = this.cache.get(gl);
    if (!record) {
      this.cache.set(gl, {});
    }
    this.cache.get(gl)![param] = value;
  }

  private compileProgram(gl: WebGL2RenderingContext): void {
    const program = gl.createProgram();
    if (!program) {
      throw new Error(`Cannot create program`);
    }
    const vertex = this.compileShader(gl, vertexShader2d, gl.VERTEX_SHADER);
    const fragment = this.compileShader(gl, this.fragmentShaderSrc, gl.FRAGMENT_SHADER);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    this.cacheSet(gl, 'program', program);
  }

  private compileShader(
    gl: WebGL2RenderingContext,
    shaderSrc: string,
    shaderType: typeof gl['VERTEX_SHADER'] | typeof gl['FRAGMENT_SHADER']
  ): WebGLShader {
    const shader = gl.createShader(shaderType);
    if (!shader) {
      throw new Error('cannot create shader');
    }
    gl.shaderSource(shader, shaderSrc);
    gl.compileShader(shader);
    const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (!compiled) {
      const lastError = gl.getShaderInfoLog(shader);
      const error = new Error(`Error during compilation of shader ${shader}: ${lastError}`);
      gl.deleteShader(shader);
      // TODO add err handling
      // throw error;
    }
    return shader;
  }

  private createPositionBuffer(gl: WebGL2RenderingContext): void {
    const buffer = gl.createBuffer();
    if (!buffer) {
      throw new Error('Cannot create position buffer');
    }
    this.cacheSet(gl, 'positionBuffer', buffer);
  }

  private loadTexture(
    gl: WebGL2RenderingContext,
    image: HTMLImageElement,
    cacheKey: keyof FxCache,
    filter: number = gl.LINEAR
  ): void {
    if (!this.ready()) return;
    const texture = gl.createTexture();
    if (!texture) return;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    this.cacheSet(gl, cacheKey, texture);
  }

  private createTexCoordBuffer(gl: WebGL2RenderingContext): void {
    const buffer = gl.createBuffer();
    if (!buffer) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0.0, 0.0,
      1.0, 0.0,
      0.0, 1.0,
      0.0, 1.0,
      1.0, 0.0,
      1.0, 1.0,
    ]), gl.STATIC_DRAW);
    this.cacheSet(gl, 'texCoordBuffer', buffer);
  }
}
