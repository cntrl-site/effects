interface ContextEntry {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  isInUse: boolean;
  lastUsed: number;
}

export class WebGLContextManager {
  private contexts: ContextEntry[] = [];
  private maxContexts = 14;
  private contextMap = new WeakMap<HTMLCanvasElement, WebGL2RenderingContext>();

  getContext(canvas: HTMLCanvasElement): WebGL2RenderingContext | null {
    const existingContext = this.contextMap.get(canvas);
    if (existingContext) {
      this.markContextAsUsed(existingContext);
      return existingContext;
    }

    const freeEntry = this.contexts.find(entry => !entry.isInUse);
    if (freeEntry) {
      this.assignContextToCanvas(freeEntry, canvas);
      return freeEntry.gl;
    }

    if (this.contexts.length < this.maxContexts) {
      const newEntry = this.createNewContext();
      if (newEntry) {
        this.assignContextToCanvas(newEntry, canvas);
        return newEntry.gl;
      }
    }

    const oldestEntry = this.findOldestUnusedContext();
    if (oldestEntry) {
      this.cleanupContext(oldestEntry.gl);
      this.assignContextToCanvas(oldestEntry, canvas);
      return oldestEntry.gl;
    }

    return null;
  }

  releaseContext(canvas: HTMLCanvasElement): void {
    const context = this.contextMap.get(canvas);
    if (!context) return;

    const entry = this.contexts.find(e => e.gl === context);
    if (entry) {
      entry.isInUse = false;
      entry.lastUsed = Date.now();
      context.clearColor(0, 0, 0, 0);
      context.clear(context.COLOR_BUFFER_BIT);
    }

    this.contextMap.delete(canvas);
  }

  private createNewContext(): ContextEntry | null {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    canvas.style.display = 'none';

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      antialias: false
    });

    if (!gl) return null;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const entry: ContextEntry = {
      gl,
      canvas,
      isInUse: false,
      lastUsed: Date.now()
    };

    this.contexts.push(entry);
    return entry;
  }

  private assignContextToCanvas(entry: ContextEntry, targetCanvas: HTMLCanvasElement): void {
    entry.isInUse = true;
    entry.lastUsed = Date.now();
    this.contextMap.set(targetCanvas, entry.gl);

    entry.canvas.width = targetCanvas.width;
    entry.canvas.height = targetCanvas.height;
  }

  private markContextAsUsed(context: WebGL2RenderingContext): void {
    const entry = this.contexts.find(e => e.gl === context);
    if (entry) {
      entry.lastUsed = Date.now();
    }
  }

  private findOldestUnusedContext(): ContextEntry | null {
    const unusedContexts = this.contexts.filter(entry => !entry.isInUse);
    if (unusedContexts.length === 0) return null;

    return unusedContexts.reduce((oldest, current) =>
      current.lastUsed < oldest.lastUsed ? current : oldest
    );
  }

  private cleanupContext(gl: WebGL2RenderingContext): void {
    gl.useProgram(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  renderToCanvas(sourceGl: WebGL2RenderingContext, targetCanvas: HTMLCanvasElement): void {
    const targetContext = targetCanvas.getContext('2d');
    if (!targetContext) return;

    const sourceEntry = this.contexts.find(e => e.gl === sourceGl);
    if (!sourceEntry) return;

    targetContext.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    targetContext.drawImage(sourceEntry.canvas, 0, 0);
  }

  updateContextSize(gl: WebGL2RenderingContext, width: number, height: number): void {
    const entry = this.contexts.find(e => e.gl === gl);
    if (entry) {
      entry.canvas.width = width;
      entry.canvas.height = height;
    }
  }

  getStats() {
    return {
      total: this.contexts.length,
      inUse: this.contexts.filter(e => e.isInUse).length,
      free: this.contexts.filter(e => !e.isInUse).length
    };
  }
}
