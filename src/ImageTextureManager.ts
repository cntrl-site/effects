import { TextureManager } from './types/TextureManager';

export class ImageTextureManager implements TextureManager {
  private image: HTMLImageElement;

  constructor(url: string) {
    this.image = new Image();
    this.image.crossOrigin = 'anonymous';
    this.image.src = url.startsWith('blob') ? url : `${url}?dt=${Date.now()}`;
  }

  getElement(): HTMLImageElement {
    return this.image;
  }

  ready(): boolean {
    return this.image.complete;
  }

  getWidth(): number {
    return this.image.width;
  }

  getHeight(): number {
    return this.image.height;
  }
}
