import type { EventType, Tier } from '../../shared/types';

export type Family = 'focus' | 'paste' | 'typing' | 'camera' | 'mic' | 'appeal' | 't1' | 'neutral';

export const EVENT_LABEL: Record<EventType, string> = {
  start: 'Session started',
  tab_hidden: 'Left the test tab',
  tab_visible: 'Returned to the test tab',
  window_blur: 'Test window lost focus',
  fullscreen_exit: 'Exited full screen',
  fullscreen_enter: 'Entered full screen',
  paste: 'Pasted text into an answer',
  copy_question: 'Copied question text',
  untrusted_input: 'Input not typed on a keyboard (scripted)',
  burst_after_return: 'Burst of typing right after returning',
  snapshot: 'Random still captured',
  camera_off: 'Camera turned off',
  diary: 'Candidate note',
  answer_saved: 'Answer saved',
  submit: 'Submitted',
  shared_wrong_answers: 'Shared unusual wrong answers with another candidate',
  grader_injection: 'Instructions to the grader found in answer',
  face_absent: 'No face in frame',
  multiple_faces: 'Second person in frame',
  face_present: 'Face back in frame',
  mic_speech: 'Speech detected (context only)',
  appeal: 'Candidate disputed a flag',
};

export function familyOf(type: EventType, tier: Tier): Family {
  if (tier === 'T1') return 't1';
  switch (type) {
    case 'tab_hidden': case 'tab_visible': case 'window_blur': case 'fullscreen_exit': case 'fullscreen_enter':
      return 'focus';
    case 'paste': case 'copy_question':
      return 'paste';
    case 'untrusted_input': case 'burst_after_return': case 'grader_injection':
      return 'typing';
    case 'snapshot': case 'camera_off': case 'face_absent': case 'multiple_faces': case 'face_present':
      return 'camera';
    case 'mic_speech':
      return 'mic';
    case 'appeal':
      return 'appeal';
    default:
      return 'neutral';
  }
}

export const FAMILY_COLOR: Record<Family, string> = {
  focus: 'var(--sig-focus)',
  paste: 'var(--sig-paste)',
  typing: 'var(--sig-typing)',
  camera: 'var(--sig-camera)',
  mic: 'var(--sig-mic)',
  appeal: '#C2185B',
  t1: '#8A1C1C',
  neutral: 'var(--border-strong)',
};

export const FAMILY_LABEL: Record<Family, string> = {
  focus: 'Focus / tab',
  paste: 'Paste / copy',
  typing: 'Typing pattern',
  camera: 'Camera / face presence',
  mic: 'Microphone (context only)',
  appeal: 'Candidate dispute',
  t1: 'Server-computed (T1)',
  neutral: 'Session',
};

export function countdown(dueAt: string, now = Date.now()): string {
  const ms = new Date(dueAt).getTime() - now;
  if (ms <= 0) return 'Window closed';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${String(m).padStart(2, '0')}m left`;
}

export function fmtDateTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** Turn an event detail into readable text (face events carry seconds). */
export function eventDetail(type: EventType, detail?: string): string | undefined {
  if (!detail) return undefined;
  if ((type === 'face_absent' || type === 'multiple_faces') && /^\d+(\.\d+)?$/.test(detail.trim())) {
    return `${Math.round(Number(detail))} seconds`;
  }
  if (type === 'appeal') return `“${detail}”`;
  return detail;
}
