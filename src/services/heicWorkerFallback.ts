/**
 * HEIC-to-JPEG conversion offloaded to a Web Worker when available.
 *
 * Falls back to main-thread conversion on platforms without Worker support
 * (React Native, older browsers, SSR).
 *
 * Why: heic2any performs heavy synchronous WASM/JS computation inside its
 * promise — at scale this freezes the UI for 2-5s per image.
 */

import type { HeicConvertResult } from './imageUtils';

const HAS_WORKER = typeof Worker !== 'undefined' && typeof Blob !== 'undefined';

let workerInstance: Worker | null = null;
let workerIdCounter = 0;

function getOrCreateWorker(): Worker | null {
  if (!HAS_WORKER) return null;
  if (workerInstance) return workerInstance;

  try {
    const workerCode = `
      self.onmessage = async function(e) {
        const { id, buffer, name } = e.data;
        try {
          const mod = await import('heic2any');
          const heic2any = mod.default || mod;
          const blob = new Blob([buffer], { type: 'image/heic' });
          const converted = await heic2any({ blob, toType: 'image/jpeg', quality: 0.92 });
          const result = Array.isArray(converted) ? converted[0] : converted;
          const ab = await result.arrayBuffer();
          self.postMessage({ id, ok: true, buffer: ab, name }, [ab]);
        } catch (err) {
          self.postMessage({ id, ok: false, error: String(err) });
        }
      };
    `;
    const blobUrl = URL.createObjectURL(new Blob([workerCode], { type: 'application/javascript' }));
    workerInstance = new Worker(blobUrl, { type: 'module' });
    return workerInstance;
  } catch {
    return null;
  }
}

/**
 * Convert HEIC/HEIF to JPEG, offloading to a Web Worker when possible.
 * Non-HEIC files are returned unchanged.
 */
export async function convertHeicOffThread(file: File | Blob): Promise<HeicConvertResult> {
  const mime = (file.type ?? '').toLowerCase();
  if (mime !== 'image/heic' && mime !== 'image/heif') {
    return { file, conversionFailed: false };
  }

  const worker = getOrCreateWorker();

  if (!worker) {
    const { convertHeicToJpegWithStatus } = await import('./imageUtils');
    return convertHeicToJpegWithStatus(file);
  }

  const id = ++workerIdCounter;
  const originalName = file instanceof File ? file.name : 'photo.heic';
  const buffer = await file.arrayBuffer();

  return new Promise<HeicConvertResult>((resolve) => {
    const timeout = setTimeout(() => {
      cleanup();
      // Timeout — fall back to main thread
      import('./imageUtils').then(({ convertHeicToJpegWithStatus }) =>
        convertHeicToJpegWithStatus(file).then(resolve),
      );
    }, 30_000);

    function handler(e: MessageEvent) {
      if (e.data?.id !== id) return;
      cleanup();

      if (e.data.ok) {
        const jpegName = originalName.replace(/\.hei[cf]$/i, '.jpg');
        const resultFile = new File([e.data.buffer], jpegName, { type: 'image/jpeg' });
        resolve({ file: resultFile, conversionFailed: false });
      } else {
        console.error('[heicWorkerFallback] worker conversion failed:', e.data.error);
        resolve({ file, conversionFailed: true });
      }
    }

    function cleanup() {
      clearTimeout(timeout);
      worker!.removeEventListener('message', handler);
    }

    worker.addEventListener('message', handler);
    worker.postMessage({ id, buffer, name: originalName }, [buffer]);
  });
}
