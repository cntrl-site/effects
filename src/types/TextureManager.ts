export interface TextureManager {
  getElement(): HTMLImageElement | HTMLVideoElement;
  ready(): boolean;
  getWidth(): number;
  getHeight(): number;
  updatesOnRender(): boolean;
}
