export interface EffectRenderer {
  ready(): boolean;
  render(gl: WebGL2RenderingContext): void;
  prepare?(gl: WebGL2RenderingContext): void;
}
