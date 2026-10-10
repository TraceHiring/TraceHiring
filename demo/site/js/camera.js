// Camera and on-device processing (rule 8). Frames never leave this browser.
// Background blur: the frame is down-scaled and up-scaled (a cheap, cross-browser blur), then
// the centre ellipse where the candidate sits is drawn back sharp. This stands in for the
// product's on-device person segmentation.
import { putStill } from './store.js';
import { randomToken } from './util.js';

export const STILL_W = 240;
export const STILL_H = 180;

let stream = null;
let video = null;

export function cameraSupported() {
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

export function isCameraOn() {
  return Boolean(stream && stream.getVideoTracks().some((t) => t.readyState === 'live'));
}

export async function startCamera() {
  if (isCameraOn()) return video;
  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false,
  });
  video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.srcObject = stream;
  await video.play();
  return video;
}

export function stopCamera() {
  if (stream) for (const track of stream.getTracks()) track.stop();
  stream = null;
  video = null;
}

export function getVideo() {
  return isCameraOn() ? video : null;
}

const scratch = { small: null };

/** Draws `source` into `canvas` with the background blurred and the centre kept sharp. */
export function drawBlurred(source, canvas, { mirror = true } = {}) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');
  const sw = source.videoWidth || source.width;
  const sh = source.videoHeight || source.height;
  if (!sw || !sh) return false;
  // Cover-fit crop.
  const scale = Math.max(w / sw, h / sh);
  const cw = w / scale;
  const ch = h / scale;
  const cx = (sw - cw) / 2;
  const cy = (sh - ch) / 2;

  if (!scratch.small) scratch.small = document.createElement('canvas');
  const small = scratch.small;
  small.width = Math.max(8, Math.round(w / 14));
  small.height = Math.max(6, Math.round(h / 14));
  const sctx = small.getContext('2d');
  sctx.imageSmoothingEnabled = true;

  ctx.save();
  if (mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  sctx.drawImage(source, cx, cy, cw, ch, 0, 0, small.width, small.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, w, h);
  // Sharp subject ellipse.
  ctx.beginPath();
  ctx.ellipse(w / 2, h * 0.52, w * 0.21, h * 0.4, 0, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(source, cx, cy, cw, ch, 0, 0, w, h);
  ctx.restore();
  return true;
}

/** Takes a small blurred JPEG still and keeps it in this browser only. Returns its id. */
export function captureStill(source = getVideo(), label = '') {
  if (!source) return null;
  const canvas = document.createElement('canvas');
  canvas.width = STILL_W;
  canvas.height = STILL_H;
  if (!drawBlurred(source, canvas)) return null;
  if (label) stamp(canvas, label);
  const id = randomToken('still_', 10);
  const ok = putStill(id, canvas.toDataURL('image/jpeg', 0.72));
  return ok ? id : id; // memory fallback still holds it for this session
}

function stamp(canvas, label) {
  const ctx = canvas.getContext('2d');
  ctx.font = '600 10px system-ui, sans-serif';
  const width = ctx.measureText(label).width + 10;
  ctx.fillStyle = 'rgba(21, 23, 28, 0.72)';
  ctx.fillRect(6, canvas.height - 20, width, 15);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, 11, canvas.height - 9);
}

/**
 * Renders a still with the viewer watermark baked into the pixels (plan §10.1), so a
 * screenshot carries the viewer's identity.
 */
export function watermarked(dataUrl, viewerText) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width * 2;
      canvas.height = img.height * 2;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate(-Math.PI / 9);
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
      ctx.textAlign = 'center';
      for (let y = -canvas.height; y < canvas.height; y += 46) {
        ctx.fillText(viewerText, 0, y);
      }
      ctx.restore();
      resolve(canvas);
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/** Synthetic scene for seeded candidates: a drawn silhouette, never a real person. */
export function syntheticStill(seed = 0, { secondPerson = false, label = 'SYNTHETIC' } = {}) {
  const src = document.createElement('canvas');
  src.width = 320;
  src.height = 240;
  const ctx = src.getContext('2d');
  const hues = [210, 30, 160, 280, 340, 90];
  const hue = hues[seed % hues.length];
  const grad = ctx.createLinearGradient(0, 0, 320, 240);
  grad.addColorStop(0, `hsl(${hue}, 25%, 72%)`);
  grad.addColorStop(1, `hsl(${(hue + 40) % 360}, 20%, 48%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 320, 240);
  // Room shapes (shelf, window) that the blur should hide.
  ctx.fillStyle = `hsl(${(hue + 180) % 360}, 30%, 60%)`;
  ctx.fillRect(20, 30, 70, 90);
  ctx.fillStyle = 'hsl(45, 60%, 80%)';
  ctx.fillRect(230, 20, 70, 60);
  const person = (x, y, s, tone) => {
    ctx.fillStyle = tone;
    ctx.beginPath();
    ctx.arc(x, y, 30 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(x, y + 95 * s, 62 * s, 58 * s, 0, Math.PI, 0);
    ctx.fill();
  };
  if (secondPerson) person(262, 120, 0.75, 'hsl(25, 25%, 32%)');
  person(160, 112, 1, 'hsl(25, 30%, 38%)');
  const canvas = document.createElement('canvas');
  canvas.width = STILL_W;
  canvas.height = STILL_H;
  drawBlurred(src, canvas, { mirror: false });
  if (secondPerson) {
    // The second person sits outside the sharp ellipse, so redraw that region lightly so a
    // reviewer can still see that someone is there (raw media a reviewer can view).
    const c2 = canvas.getContext('2d');
    c2.globalAlpha = 0.85;
    c2.drawImage(src, 215, 60, 105, 180, 215 * 0.75, 60 * 0.75, 105 * 0.75, 180 * 0.75);
    c2.globalAlpha = 1;
  }
  stamp(canvas, label);
  return canvas.toDataURL('image/jpeg', 0.72);
}
