import { TextureManager } from './types/TextureManager';

export class VideoTextureManager implements TextureManager {
  private listeners: ((isReady: boolean) => void)[] = [];
  private isReady = false;
  private video: HTMLVideoElement;

  constructor(videoUrl: string) {
    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.controls = true;
    video.crossOrigin = 'anonymous';
    video.addEventListener('loadedmetadata', () => {
      video.play().then(() => {
        this.isReady = true;
        this.listeners.forEach(listener => listener(true));
      });
    });
    video.src = videoUrl;
    this.video = video;
  }

  updatesOnRender(): boolean {
    return true;
  }

  onReadyStatusChange(listener: (isReady: boolean) => void): void {
    this.listeners.push(listener);
  }

  getElement(): HTMLVideoElement {
    return this.video;
  }

  ready(): boolean {
    return this.isReady;
  }

  getWidth(): number {
    return this.video.videoWidth;
  }

  getHeight(): number {
    return this.video.videoHeight;
  }
}
