// On-device face presence and mic level. Camera frames and audio NEVER leave the device:
// only counts (faces) and a level number are computed here. The single exception is the
// allow-listed still around a multiple_faces event, captured by the caller.
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

export type Presence = 'present' | 'absent' | 'multiple' | 'unknown';
type FaceCounter = (video: HTMLVideoElement) => number | null;

const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

let detectorPromise: Promise<FaceCounter | null> | null = null;

async function loadMediaPipe(): Promise<FaceCounter | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vision: any = await import(/* @vite-ignore */ `${MP}/vision_bundle.mjs`);
  const fs = await vision.FilesetResolver.forVisionTasks(`${MP}/wasm`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const det: any = await vision.FaceDetector.createFromOptions(fs, {
    baseOptions: { modelAssetPath: MODEL },
    runningMode: 'VIDEO',
    minDetectionConfidence: 0.5,
  });
  let lastTs = 0;
  return (video) => {
    if (video.readyState < 2 || !video.videoWidth) return null;
    const ts = Math.max(performance.now(), lastTs + 1);
    lastTs = ts;
    return (det.detectForVideo(video, ts).detections as unknown[]).length;
  };
}

function loadNative(): FaceCounter | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const FD = (window as any).FaceDetector;
  if (!FD) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const det: any = new FD({ fastMode: true, maxDetectedFaces: 5 });
  let last: number | null = null;
  let busy = false;
  // Native detect() is async; return the latest known count.
  return (video) => {
    if (video.readyState < 2 || !video.videoWidth) return null;
    if (!busy) {
      busy = true;
      det.detect(video).then((faces: unknown[]) => { last = faces.length; }).catch(() => undefined).finally(() => { busy = false; });
    }
    return last;
  };
}

export function getFaceCounter(): Promise<FaceCounter | null> {
  if (!detectorPromise) {
    detectorPromise = loadMediaPipe().catch(() => null).then((c) => c ?? (() => { try { return loadNative(); } catch { return null; } })());
  }
  return detectorPromise;
}

export interface PresenceHandlers {
  onAbsent?: (seconds: number) => void;
  onPresent?: () => void;
  onMultiple?: (seconds: number) => void;
}

/** Samples ~2x per second. Emits debounced events through handlers (if given). */
export function usePresence(videoRef: RefObject<HTMLVideoElement>, enabled: boolean, handlers?: PresenceHandlers): Presence {
  const [presence, setPresence] = useState<Presence>('unknown');
  const hRef = useRef(handlers);
  hRef.current = handlers;

  useEffect(() => {
    if (!enabled) { setPresence('unknown'); return; }
    let alive = true;
    let counter: FaceCounter | null = null;
    let absentSince: number | null = null;
    let lastAbsentReport = 0;
    let absentReported = false;
    let multiSince: number | null = null;
    let multiReported = false;
    let lastMultiReport = 0;

    void getFaceCounter().then((c) => { counter = c; });

    const h = setInterval(() => {
      if (!alive || !counter || !videoRef.current) return;
      let n: number | null = null;
      try { n = counter(videoRef.current); } catch { n = null; }
      if (n === null) return;
      const now = Date.now();
      const p: Presence = n === 0 ? 'absent' : n > 1 ? 'multiple' : 'present';
      setPresence(p);

      // Absent stretches.
      if (p === 'absent') {
        if (absentSince === null) { absentSince = now; absentReported = false; lastAbsentReport = now; }
        const secs = Math.round((now - absentSince) / 1000);
        if (secs >= 10 && now - lastAbsentReport >= 10000) {
          lastAbsentReport = now;
          absentReported = true;
          hRef.current?.onAbsent?.(secs);
        }
      } else if (absentSince !== null) {
        const secs = Math.round((now - absentSince) / 1000);
        if (secs >= 5) {
          hRef.current?.onAbsent?.(secs);
          hRef.current?.onPresent?.();
        } else if (absentReported) hRef.current?.onPresent?.();
        absentSince = null;
      }

      // Multiple faces stretches (once per stretch, 30s cooldown).
      if (p === 'multiple') {
        if (multiSince === null) { multiSince = now; multiReported = false; }
        const secs = (now - multiSince) / 1000;
        if (!multiReported && secs >= 3 && now - lastMultiReport >= 30000) {
          multiReported = true;
          lastMultiReport = now;
          hRef.current?.onMultiple?.(Math.round(secs));
        }
      } else multiSince = null;
    }, 500);
    return () => { alive = false; clearInterval(h); };
  }, [enabled, videoRef]);

  return presence;
}

/**
 * Live mic level (RMS 0..1) computed on device with WebAudio. Audio is never recorded or uploaded.
 * onSpeech fires when the level stays above threshold for >= 5s, at most once per 60s.
 */
export function useMicLevel(stream: MediaStream | null, onSpeech?: () => void): number {
  const [level, setLevel] = useState(0);
  const cbRef = useRef(onSpeech);
  cbRef.current = onSpeech;

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) { setLevel(0); return; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AC: typeof AudioContext | undefined = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!AC) return;
    let ctx: AudioContext;
    try { ctx = new AC(); } catch { return; }
    const src = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
    const an = ctx.createAnalyser();
    an.fftSize = 1024;
    src.connect(an); // not connected to destination: nothing is played or recorded
    const buf = new Float32Array(an.fftSize);
    let loudSince: number | null = null;
    let lastQuiet = Date.now();
    let lastFire = 0;
    const THRESH = 0.04;
    const h = setInterval(() => {
      an.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      setLevel(Math.min(1, rms * 6));
      const now = Date.now();
      if (rms > THRESH) {
        if (loudSince === null) loudSince = now;
        lastQuiet = 0;
        if (now - loudSince >= 5000 && now - lastFire >= 60000) { lastFire = now; cbRef.current?.(); }
      } else {
        if (!lastQuiet) lastQuiet = now;
        if (now - lastQuiet > 800) loudSince = null; // tolerate short pauses between words
      }
    }, 100);
    void ctx.resume().catch(() => undefined);
    return () => { clearInterval(h); src.disconnect(); void ctx.close().catch(() => undefined); };
  }, [stream]);

  return level;
}
