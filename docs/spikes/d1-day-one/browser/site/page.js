// DC-D5 part (c): the recruiter-page side of the media link. Served as an external script because the recruiter
// CSP has script-src 'self' (no inline script). It never logs or returns a jti or sig: blocked URIs are redacted.
'use strict';

const violations = [];
window.__violations = violations;

const redact = (s) => String(s).replace(/(\/media\/)[0-9a-f-]{36}\?\S*/g, '$1[jti]?[redacted]');

document.addEventListener('securitypolicyviolation', (e) => {
  violations.push({
    violatedDirective: e.violatedDirective,
    effectiveDirective: e.effectiveDirective,
    blockedURI: redact(e.blockedURI),
    blockedHadFullLink: /\/media\/[0-9a-f-]{36}\?exp=\d+&sig=/.test(e.blockedURI),
    disposition: e.disposition,
  });
});

const VISIBLE = [
  'content-type',
  'cache-control',
  'content-length',
  'access-control-allow-origin',
  'x-content-type-options',
  'referrer-policy',
  'vary',
  'cross-origin-resource-policy',
];

const FETCH_INIT = {
  mode: 'cors',
  credentials: 'omit',
  cache: 'no-store',
  referrerPolicy: 'no-referrer',
};

function watermark(ctx, w, h, label) {
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 3;
  ctx.font = 'bold 20px sans-serif';
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 8);
  for (let y = -h; y < h; y += 56) {
    for (let x = -w; x < w; x += 330) {
      ctx.strokeText(label, x, y);
      ctx.fillText(label, x, y);
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, h - 26, w, 26);
  ctx.fillStyle = '#ffffff';
  ctx.font = '14px sans-serif';
  ctx.fillText(label, 8, h - 8);
}

function differingPixels(a, b) {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
  }
  return n;
}

function waitImg(img, src, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), ms);
    img.onload = () => {
      clearTimeout(timer);
      resolve('loaded');
    };
    img.onerror = () => {
      clearTimeout(timer);
      resolve('error');
    };
    img.src = src;
  });
}

window.d5 = {
  violations: () => violations.slice(),
  resetViolations: () => {
    violations.length = 0;
  },

  // The designed path: CORS fetch -> blob -> createImageBitmap -> canvas -> watermark -> data: URL in an <img>.
  async fetchAndWatermark(url, options = {}) {
    const out = {};
    const res = await fetch(url, FETCH_INIT);
    out.status = res.status;
    out.type = res.type;
    out.visibleHeaders = Object.fromEntries(VISIBLE.map((n) => [n, res.headers.get(n)]));
    if (!res.ok) {
      out.errorBody = await res.text();
      return out;
    }
    const blob = await res.blob();
    out.blobType = blob.type;
    out.blobSize = blob.size;
    const bmp = await createImageBitmap(blob);
    const canvas = document.getElementById('c');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const before = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    watermark(
      ctx,
      canvas.width,
      canvas.height,
      'reviewer | org-synthetic-1 | 2026-10-16T12:00:00Z',
    );
    const after = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    out.size = { w: canvas.width, h: canvas.height };
    out.changedPixels = differingPixels(before, after);
    out.tainted = false;
    try {
      canvas.toDataURL('image/png');
    } catch (e) {
      out.tainted = e.name;
    }
    if (options.display === 'blob') {
      const blobOut = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
      const blobUrl = URL.createObjectURL(blobOut);
      const img = new Image();
      img.id = 'blob-img';
      out.blobDisplay = await waitImg(img, blobUrl, 3000);
      out.blobUrlScheme = blobUrl.slice(0, 5);
      if (out.blobDisplay === 'loaded') document.getElementById('out').appendChild(img);
      return out;
    }
    const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
    out.dataUrlPrefix = dataUrl.slice(0, 23);
    out.dataUrlLength = dataUrl.length;
    const img = new Image();
    img.id = 'data-img';
    out.dataDisplay = await waitImg(img, dataUrl, 3000);
    out.dataImg = { w: img.naturalWidth, h: img.naturalHeight };
    if (out.dataDisplay === 'loaded') document.getElementById('out').appendChild(img);
    return out;
  },

  // An <img> element pointed at the media URL (what the CSP img-src would have to allow).
  async imgTaint(url, crossorigin) {
    const img = new Image();
    if (crossorigin) img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    const out = { crossorigin, load: await waitImg(img, url, 4000) };
    if (out.load !== 'loaded') return out;
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    try {
      c.toDataURL();
      out.toDataURL = 'ok';
    } catch (e) {
      out.toDataURL = e.name;
    }
    try {
      ctx.getImageData(0, 0, 1, 1);
      out.getImageData = 'ok';
    } catch (e) {
      out.getImageData = e.name;
    }
    return out;
  },

  // Anything the page does that is not the designed request: each returns what the browser allowed.
  async tryFetch(url, init) {
    try {
      const res = await fetch(url, { ...FETCH_INIT, ...init });
      let imageBitmap = null;
      const blob = await res.blob();
      try {
        await createImageBitmap(blob);
        imageBitmap = 'ok';
      } catch (e) {
        imageBitmap = e.name;
      }
      return { ok: true, status: res.status, type: res.type, blobSize: blob.size, imageBitmap };
    } catch (e) {
      return { ok: false, error: e.name, message: redact(e.message) };
    }
  },

  async createBlobUrlFromFetch(url) {
    const res = await fetch(url, FETCH_INIT);
    const blob = await res.blob();
    return { size: blob.size, scheme: URL.createObjectURL(blob).slice(0, 5) };
  },
};
