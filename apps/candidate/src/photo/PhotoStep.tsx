// Step 5, the start photo (specs/d1-demo-slice.md §4.5, §4.7; rule 8). This file is the lazy entry of the photo
// chunk and the only importer of camera.ts, blur.ts and jpeg.ts. The camera turns on only when the candidate asks (after the
// consent step succeeded). Frames go from an offscreen video element (never on screen, no blob: URL) through
// `blurOutsideOval` onto the visible canvas, which is also the canvas the JPEG is exported from, so no sharp pixel
// outside the oval is in any uploaded buffer. Every track stops as soon as the shot is taken, on Retake-exit, on skip
// and on unmount. Only the processed JPEG leaves the device. No face, gaze or emotion model runs here (rule 7).
import type { PhotoSkippedReason } from '@trace/shared/contracts/candidate';
import { useEffect, useRef, useState } from 'react';
import type { CandidateApi } from '../api';
import { COPY } from '../copy';
import type { PhotoChoice } from '../flow';
import { ErrorSummary, Status, StepHeading, ui } from '../ui';
import { blurOutsideOval, ovalOf } from './blur';
import { openCamera, stopStream } from './camera';
import { sha256Hex } from './hash';
import { stripJpegMetadata } from './jpeg';
import styles from './PhotoStep.module.css';

interface Props {
  api: CandidateApi;
  lobbyToken: string;
  onDone(photo: PhotoChoice): void;
  onStepError(): void;
}

type Phase = 'intro' | 'starting' | 'live' | 'shot' | 'uploading' | 'denied' | 'none';

/** The frame size: the camera's, scaled to fit 640x480, never under the edge's 160 px minimum. */
export const frameSize = (videoWidth: number, videoHeight: number) => {
  if (!(videoWidth > 0 && videoHeight > 0)) return { width: 640, height: 480 };
  const scale = Math.min(1, 640 / videoWidth, 480 / videoHeight);
  return {
    width: Math.max(160, Math.round(videoWidth * scale)),
    height: Math.max(160, Math.round(videoHeight * scale)),
  };
};

const JPEG_QUALITY = 0.85;
const PREVIEW_EVERY_MS = 100;

const toJpeg = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
  new Promise((resolve) => {
    try {
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
    } catch {
      resolve(null);
    }
  });

export function PhotoStep({ api, lobbyToken, onDone, onStepError }: Props) {
  const [phase, setPhase] = useState<Phase>('intro');
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rawRef = useRef<HTMLCanvasElement | null>(null);
  const jpegRef = useRef<Uint8Array | null>(null);
  const aliveRef = useRef(true);

  const stopCamera = () => {
    stopStream(streamRef.current);
    streamRef.current = null;
    const video = videoRef.current;
    if (video !== null) {
      video.pause();
      video.srcObject = null;
    }
    videoRef.current = null;
  };

  /** Draws the current camera frame, blurred outside the oval, onto the visible canvas. */
  const renderFrame = (): boolean => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video === null || canvas === null) return false;
    const { width, height } = frameSize(video.videoWidth, video.videoHeight);
    const raw = rawRef.current ?? document.createElement('canvas');
    rawRef.current = raw;
    if (raw.width !== width || raw.height !== height) {
      raw.width = width;
      raw.height = height;
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const rawCtx = raw.getContext('2d', { willReadFrequently: true });
    const ctx = canvas.getContext('2d');
    if (rawCtx === null || ctx === null) return false;
    rawCtx.drawImage(video, 0, 0, width, height);
    const frame = rawCtx.getImageData(0, 0, width, height);
    const out = blurOutsideOval({ data: frame.data, width, height }, ovalOf(width, height));
    const target = ctx.createImageData(width, height);
    target.data.set(out.data);
    ctx.putImageData(target, 0, 0);
    // The sharp frame never stays in a buffer: the offscreen canvas is cleared after each frame.
    rawCtx.clearRect(0, 0, width, height);
    return true;
  };

  // Unmount (or leaving the step) stops the camera.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      stopStream(streamRef.current);
      streamRef.current = null;
      videoRef.current = null;
    };
  }, []);

  // The live preview, about ten frames a second, only while the camera is on.
  useEffect(() => {
    if (phase !== 'live') return;
    let frame = 0;
    let last = -Infinity;
    const loop = (now: number) => {
      if (now - last >= PREVIEW_EVERY_MS) {
        last = now;
        renderFrame();
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  const startCamera = async () => {
    setError(null);
    setPhase('starting');
    const res = await openCamera();
    if (!aliveRef.current) {
      if (res.ok) stopStream(res.stream);
      return;
    }
    if (!res.ok) {
      setPhase(res.reason === 'camera_denied' ? 'denied' : 'none');
      return;
    }
    streamRef.current = res.stream;
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = res.stream;
    videoRef.current = video;
    try {
      await video.play();
    } catch {
      // a muted inline video may still start on its own; the frame size falls back to 640x480
    }
    if (!aliveRef.current) {
      stopCamera();
      return;
    }
    setPhase('live');
  };

  const take = async () => {
    const drawn = renderFrame();
    // The shot is taken: the camera goes off at once.
    stopCamera();
    const canvas = canvasRef.current;
    if (!drawn || canvas === null) {
      setError(COPY.photo.unusable);
      setPhase('intro');
      return;
    }
    setPhase('shot');
    const blob = await toJpeg(canvas);
    if (!aliveRef.current) return;
    if (blob === null) {
      setError(COPY.photo.unusable);
      setPhase('intro');
      return;
    }
    const encoded = new Uint8Array(await blob.arrayBuffer());
    if (!aliveRef.current) return;
    try {
      // APP0-only (rev 4i): the browser's ICC profile, Exif or comment segments never leave the device.
      jpegRef.current = stripJpegMetadata(encoded);
    } catch {
      jpegRef.current = null;
      setError(COPY.photo.unusable);
      setPhase('intro');
    }
  };

  const use = async () => {
    const jpeg = jpegRef.current;
    if (jpeg === null) return;
    setError(null);
    setPhase('uploading');
    const sha256 = await sha256Hex(jpeg);
    const res = await api.photo(lobbyToken, jpeg, sha256);
    if (!aliveRef.current) return;
    if (res.ok) {
      jpegRef.current = null;
      onDone({ sha256: res.value.sha256 });
      return;
    }
    setPhase('shot');
    if (res.code === 'step_required' || res.code === 'superseded') return onStepError();
    if (res.code === 'bad_media' || res.code === 'too_large' || res.code === 'bad_request')
      return setError(COPY.photo.unusable);
    if (res.status === 429) return setError(COPY.photo.limit);
    setError(COPY.photo.failed);
  };

  const retake = () => {
    jpegRef.current = null;
    void startCamera();
  };

  const skip = (reason: PhotoSkippedReason) => {
    stopCamera();
    jpegRef.current = null;
    onDone({ skippedReason: reason });
  };

  const skipReason: PhotoSkippedReason =
    phase === 'denied' ? 'camera_denied' : phase === 'none' ? 'no_camera' : 'declined';
  const showCanvas = phase === 'live' || phase === 'shot' || phase === 'uploading';
  const status =
    phase === 'starting'
      ? COPY.photo.starting
      : phase === 'uploading'
        ? COPY.photo.uploading
        : phase === 'shot'
          ? COPY.photo.shotTaken
          : '';

  return (
    <section>
      <StepHeading>
        {phase === 'denied'
          ? COPY.photo.deniedTitle
          : phase === 'none'
            ? COPY.photo.noneTitle
            : COPY.photo.title}
      </StepHeading>
      <ErrorSummary message={error} />
      {phase === 'denied' || phase === 'none' ? (
        <p className={ui.text}>{phase === 'denied' ? COPY.photo.denied : COPY.photo.none}</p>
      ) : (
        <>
          <p className={ui.text}>{COPY.photo.intro}</p>
          <p className={ui.text}>{COPY.photo.guide}</p>
        </>
      )}
      <Status message={status} />
      {showCanvas ? (
        <div className={styles.frame}>
          <canvas
            ref={canvasRef}
            className={styles.canvas}
            role="img"
            aria-label={phase === 'live' ? COPY.photo.live : COPY.photo.preview}
          />
          <svg
            className={styles.oval}
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
            focusable="false"
          >
            <ellipse cx="50" cy="50" rx="30" ry="42" />
          </svg>
        </div>
      ) : null}
      <div className={ui.actions}>
        {phase === 'intro' || phase === 'starting' ? (
          <button
            type="button"
            className={ui.button}
            onClick={() => void startCamera()}
            disabled={phase === 'starting'}
          >
            {COPY.photo.start}
          </button>
        ) : null}
        {phase === 'denied' || phase === 'none' ? (
          <button type="button" className={ui.button} onClick={() => void startCamera()}>
            {COPY.photo.retry}
          </button>
        ) : null}
        {phase === 'live' ? (
          <button type="button" className={ui.button} onClick={() => void take()}>
            {COPY.photo.take}
          </button>
        ) : null}
        {phase === 'shot' || phase === 'uploading' ? (
          <>
            <button
              type="button"
              className={ui.button}
              onClick={() => void use()}
              disabled={phase === 'uploading'}
            >
              {COPY.photo.use}
            </button>
            <button
              type="button"
              className={ui.secondary}
              onClick={retake}
              disabled={phase === 'uploading'}
            >
              {COPY.photo.retake}
            </button>
          </>
        ) : null}
        <button
          type="button"
          className={ui.secondary}
          onClick={() => skip(skipReason)}
          disabled={phase === 'uploading'}
        >
          {COPY.photo.skip}
        </button>
      </div>
    </section>
  );
}

export default PhotoStep;
