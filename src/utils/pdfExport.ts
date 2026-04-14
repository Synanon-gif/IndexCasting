import { jsPDF } from 'jspdf';

export type PdfModelInput = {
  name: string;
  city: string;
  height: number | null;
  chest: number | null;
  waist: number | null;
  hips: number | null;
  imageUrls: string[];
};

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 15;
const CONTENT_W = PAGE_W - 2 * MARGIN;
const IMAGE_TIMEOUT_MS = 10_000;

/**
 * Load a remote image and convert it to a JPEG data-URL via an off-screen
 * canvas. Returns `null` when the image cannot be loaded (CORS, 404, timeout,
 * unsupported format, …).
 */
function fetchImageAsJpegDataUrl(
  url: string,
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';

    const timer = setTimeout(() => {
      console.warn('[pdfExport] image load timed out:', url.slice(0, 120));
      resolve(null);
    }, IMAGE_TIMEOUT_MS);

    img.onload = () => {
      clearTimeout(timer);
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve({ dataUrl, width: img.naturalWidth, height: img.naturalHeight });
      } catch (e) {
        console.warn('[pdfExport] canvas export failed:', e);
        resolve(null);
      }
    };

    img.onerror = () => {
      clearTimeout(timer);
      console.warn('[pdfExport] image load error:', url.slice(0, 120));
      resolve(null);
    };

    img.src = url;
  });
}

function formatMeasurement(value: number | null): string {
  return value != null ? `${value} cm` : '—';
}

/**
 * Add an image to the PDF, scaling it to fit within `maxW` x `maxH` (mm) while
 * preserving the aspect ratio. Returns the actual height consumed.
 */
function addScaledImage(
  doc: jsPDF,
  dataUrl: string,
  imgW: number,
  imgH: number,
  x: number,
  y: number,
  maxW: number,
  maxH: number,
): number {
  const aspect = imgW / imgH;
  let drawW = maxW;
  let drawH = drawW / aspect;
  if (drawH > maxH) {
    drawH = maxH;
    drawW = drawH * aspect;
  }
  const offsetX = x + (maxW - drawW) / 2;
  doc.addImage(dataUrl, 'JPEG', offsetX, y, drawW, drawH);
  return drawH;
}

function ensureSpace(doc: jsPDF, cursorY: number, needed: number): number {
  if (cursorY + needed > PAGE_H - MARGIN) {
    doc.addPage();
    return MARGIN;
  }
  return cursorY;
}

export async function generateModelsPdf(
  models: PdfModelInput[],
  entityName: string,
): Promise<Blob> {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  doc.setProperties({ title: entityName });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text(entityName, MARGIN, MARGIN + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text('Generated via Index Casting', MARGIN, PAGE_H - 8);
  doc.setTextColor(0, 0, 0);

  let isFirstModel = true;

  for (const model of models) {
    if (!isFirstModel) {
      doc.addPage();
    }
    isFirstModel = false;

    let y = MARGIN;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(model.name || 'Unknown', MARGIN, y + 6);
    y += 10;

    if (model.city) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(100, 100, 100);
      doc.text(model.city, MARGIN, y + 4);
      doc.setTextColor(0, 0, 0);
      y += 7;
    }

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const measurements = [
      `Height: ${formatMeasurement(model.height)}`,
      `Chest: ${formatMeasurement(model.chest)}`,
      `Waist: ${formatMeasurement(model.waist)}`,
      `Hips: ${formatMeasurement(model.hips)}`,
    ].join('  |  ');
    doc.text(measurements, MARGIN, y + 4);
    y += 10;

    const imageResults = await Promise.all(
      model.imageUrls.map((url) => fetchImageAsJpegDataUrl(url)),
    );
    const images = imageResults.filter(
      (r): r is { dataUrl: string; width: number; height: number } => r !== null,
    );

    if (images.length === 0) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(10);
      doc.setTextColor(150, 150, 150);
      doc.text('No images available', MARGIN, y + 5);
      doc.setTextColor(0, 0, 0);
      continue;
    }

    const cover = images[0];
    const maxCoverH = PAGE_H - MARGIN - y - 5;
    const coverH = addScaledImage(
      doc,
      cover.dataUrl,
      cover.width,
      cover.height,
      MARGIN,
      y,
      CONTENT_W,
      Math.min(maxCoverH, 180),
    );
    y += coverH + 5;

    const extras = images.slice(1);
    if (extras.length > 0) {
      const gridColW = (CONTENT_W - 5) / 2;
      const gridMaxH = 110;

      for (let i = 0; i < extras.length; i += 2) {
        y = ensureSpace(doc, y, gridMaxH + 5);

        const left = extras[i];
        const leftH = addScaledImage(
          doc,
          left.dataUrl,
          left.width,
          left.height,
          MARGIN,
          y,
          gridColW,
          gridMaxH,
        );

        let rightH = 0;
        if (i + 1 < extras.length) {
          const right = extras[i + 1];
          rightH = addScaledImage(
            doc,
            right.dataUrl,
            right.width,
            right.height,
            MARGIN + gridColW + 5,
            y,
            gridColW,
            gridMaxH,
          );
        }

        y += Math.max(leftH, rightH) + 5;
      }
    }
  }

  return doc.output('blob');
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
