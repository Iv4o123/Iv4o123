// Phone cameras produce 5-15 MB photos. Shrink them before upload so they
// go through on weak mobile signal while staying sharp enough to read labels.
export async function compressPhoto(file, { maxSide = 2400, quality = 0.82 } = {}) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file; // Unsupported format (e.g. some HEIC): upload as-is and let the server decide.
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  return blob && blob.size < file.size ? blob : file;
}

// Reads a barcode / QR code from a photo, where the browser supports it (Chrome on Android).
export const canScanBarcodes = () => 'BarcodeDetector' in window;

export async function scanBarcode(file) {
  const detector = new window.BarcodeDetector();
  const bitmap = await createImageBitmap(file);
  const codes = await detector.detect(bitmap);
  return codes[0]?.rawValue ?? null;
}

// Finger / mouse signature pad on a canvas. Returns helpers to clear and export.
export function signaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  let drawing = false;
  let dirty = false;

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
    dirty = false;
  }

  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  canvas.addEventListener('pointerdown', (e) => {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    ctx.beginPath();
    ctx.moveTo(...point(e));
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    ctx.lineTo(...point(e));
    ctx.stroke();
    dirty = true;
  });
  const stop = () => {
    drawing = false;
  };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);
  resize();

  return {
    clear: resize,
    isEmpty: () => !dirty,
    // White background so the signature is visible in any viewer.
    toBlob() {
      const out = document.createElement('canvas');
      out.width = canvas.width;
      out.height = canvas.height;
      const o = out.getContext('2d');
      o.fillStyle = '#fff';
      o.fillRect(0, 0, out.width, out.height);
      o.drawImage(canvas, 0, 0);
      return new Promise((resolve) => out.toBlob(resolve, 'image/png'));
    },
  };
}

// Current position, or null if denied / unavailable within a few seconds.
export function currentPosition() {
  if (!navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  });
}
