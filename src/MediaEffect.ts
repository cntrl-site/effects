import { EffectRenderer } from './types/EffectRenderer';
import { ShaderParamAny } from './types/ShaderParam';
import { TextureManager } from './types/TextureManager';

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

interface MediaFxParams extends Record<string, ShaderParamAny['value']> {
  time: number;
  cursor: [number, number];
}

type FxCache = {
  program?: WebGLProgram;
  texture?: WebGLTexture;
  pattern1Texture?: WebGLTexture;
  pattern2Texture?: WebGLTexture;
  positionBuffer?: WebGLBuffer;
  texCoordBuffer?: WebGLBuffer;
};

export class MediaEffect implements EffectRenderer {
  private pattern1: HTMLImageElement;
  private pattern2: HTMLImageElement;
  private vpWidth: number = 100;
  private vpHeight: number = 100;
  private fxParams: MediaFxParams;
  private cache: WeakMap<WebGL2RenderingContext, FxCache> = new WeakMap();
  private fragmentShaderSrc: string;
  private statusListeners: ((status: 'ready' | 'error', message?: string) => void)[] = [];

  constructor(
    private textureManager: TextureManager,
    patternUrl: string,
    pattern2Url: string,
    fragmentShaderSrc: string,
    params: MediaFxParams,
    private imageWidth: number,
    private imageHeight: number
  ) {
    this.pattern1 = new Image();
    this.pattern1.crossOrigin = 'anonymous';
    this.pattern1.src = patternUrl;
    this.pattern2 = new Image();
    this.pattern2.crossOrigin = 'anonymous';
    this.pattern2.src = pattern2Url;
    this.fxParams = { ...params };
    this.fragmentShaderSrc = fragmentShaderSrc || defaultShader;
  }

  setViewport(width: number, height: number): void {
    this.vpWidth = width;
    this.vpHeight = height;
  }

  setParam<T extends keyof MediaFxParams>(
    name: T,
    value: MediaFxParams[T]
  ): void {
    this.fxParams[name] = value;
  }

  subscribeStatus(listener: (status: 'ready' | 'error', message?: string) => void): void {
    this.statusListeners.push(listener);
  }

  ready(): boolean {
    return this.textureManager.ready();
  }

  prepare(gl: WebGL2RenderingContext): void {
    this.ensureCache(gl);
  }

  render(gl: WebGL2RenderingContext): void {
    if (!this.ready()) return;
    const { time, cursor, ...restParams } = this.fxParams;
    this.ensureCache(gl);
    const program = this.cacheGet(gl, 'program')!;
    const posBuffer = this.cacheGet(gl, 'positionBuffer')!;
    const texBuffer = this.cacheGet(gl, 'texCoordBuffer')!;
    const texture = this.cacheGet(gl, 'texture')!;
    const pattern1Texture = this.cacheGet(gl, 'pattern1Texture')!;
    const pattern2Texture = this.cacheGet(gl, 'pattern2Texture')!;

    if (this.textureManager.updatesOnRender()) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.textureManager.getElement()
      );
    }

    gl.viewport(0, 0, this.vpWidth, this.vpHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.setupPosition(gl);
    gl.useProgram(program);
    // shader prop: a_position
    const posLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
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
    gl.uniform2f(cursorLocation, ...cursor);
    // shader prop: u_time
    const timeLocation = gl.getUniformLocation(program, 'u_time');
    gl.uniform1f(timeLocation, time);
    for (const [key, paramValue] of Object.entries(restParams)) {
      const location = gl.getUniformLocation(program, key);
      // @ts-expect-error number | [number, number] TODO type properly when [n,n] is used
      gl.uniform1f(location, paramValue);
    }
    // img + dimensions
    const imageLocation = gl.getUniformLocation(program, 'u_image');
    const dimensionsLocation = gl.getUniformLocation(program, 'u_imgDimensions');
    gl.uniform2f(dimensionsLocation, this.imageWidth, this.imageHeight);
    // pattern + dimensions
    const patternLocation = gl.getUniformLocation(program, 'u_pattern');
    const patternDimensionsLocation = gl.getUniformLocation(program, 'u_patternDimensions');
    const pattern2Location = gl.getUniformLocation(program, 'u_pattern2');
    const pattern2DimensionsLocation = gl.getUniformLocation(program, 'u_pattern2Dimensions');
    gl.uniform2f(patternDimensionsLocation, this.pattern1.width, this.pattern1.height);
    gl.uniform2f(pattern2DimensionsLocation, this.pattern2.width, this.pattern2.height);
    gl.uniform1i(imageLocation, 0);
    gl.uniform1i(patternLocation, 1);
    gl.uniform1i(pattern2Location, 2);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, pattern1Texture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, pattern2Texture);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private setupPosition(gl: WebGL2RenderingContext): void {
    const posBuffer = this.cacheGet(gl, 'positionBuffer')!;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    const imgAspectRatio = this.textureManager.getWidth() / this.textureManager.getHeight();
    const itemAspectRatio = this.vpWidth / this.vpHeight;
    const rw = itemAspectRatio < imgAspectRatio ? this.vpHeight * imgAspectRatio : this.vpWidth;
    const rh = itemAspectRatio < imgAspectRatio ? this.vpHeight : this.vpWidth / imgAspectRatio;
    const x1 = (this.vpWidth - rw) / 2;
    const y1 = (this.vpHeight - rh) / 2;
    const x2 = x1 + rw;
    const y2 = y1 + rh;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      x1,
      y1,
      x2,
      y1,
      x1,
      y2,
      x1,
      y2,
      x2,
      y1,
      x2,
      y2,
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
      this.loadTexture(gl, this.textureManager.getElement(), 'texture');
    }
    if (!this.cacheGet(gl, 'pattern1Texture')) {
      this.loadTexture(gl, this.pattern1, 'pattern1Texture', gl.NEAREST);
    }
    if (!this.cacheGet(gl, 'pattern2Texture')) {
      this.loadTexture(gl, this.pattern2, 'pattern2Texture', gl.NEAREST);
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
      if (lastError) {
        this.statusListeners.forEach((listener) => listener('error', lastError));
      }
      const error = new Error(`Error during compilation of shader ${shader}: ${lastError}`);
      gl.deleteShader(shader);
      console.error(error);
    } else {
      this.statusListeners.forEach((listener) => listener('ready'));
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
    media: HTMLImageElement | HTMLVideoElement,
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
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media);
    this.cacheSet(gl, cacheKey, texture);
  }

  private createTexCoordBuffer(gl: WebGL2RenderingContext): void {
    const buffer = gl.createBuffer();
    if (!buffer) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0.0,
      0.0,
      1.0,
      0.0,
      0.0,
      1.0,
      0.0,
      1.0,
      1.0,
      0.0,
      1.0,
      1.0,
    ]), gl.STATIC_DRAW);
    this.cacheSet(gl, 'texCoordBuffer', buffer);
  }
}
