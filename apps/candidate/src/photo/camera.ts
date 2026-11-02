// The one module that touches the camera (specs/d1-demo-slice.md §4.5, §4.7; rule 8). Only the photo step imports
// it, and only after the consent call succeeded. Video only: the microphone is never asked for, and a stream that
// somehow carries an audio track has it stopped at once. Every track is stopped as soon as the shot is taken, when
// the step is left and when it unmounts (stopStream). No device listing, recording or screen capture exists here.

export type CameraFailure = 'camera_denied' | 'no_camera';

export type CameraResult = { ok: true; stream: MediaStream } | { ok: false; reason: CameraFailure };

/** Asks for the front camera at about 640x480. Never audio. */
export const openCamera = async (): Promise<CameraResult> => {
  const devices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  if (devices === undefined || typeof devices.getUserMedia !== 'function') {
    return { ok: false, reason: 'no_camera' };
  }
  try {
    const stream = await devices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    for (const track of stream.getAudioTracks()) {
      track.stop();
      stream.removeTrack(track);
    }
    return { ok: true, stream };
  } catch (err) {
    const name = typeof err === 'object' && err !== null && 'name' in err ? String(err.name) : '';
    const denied = name === 'NotAllowedError' || name === 'SecurityError';
    return { ok: false, reason: denied ? 'camera_denied' : 'no_camera' };
  }
};

/** Stops every track of a stream (idempotent). */
export const stopStream = (stream: MediaStream | null): void => {
  if (stream === null) return;
  for (const track of stream.getTracks()) track.stop();
};
