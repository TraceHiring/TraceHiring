// Fixed user-facing text for the api failure codes the drive screens can meet. The server's own text is never shown
// (specs/d1-demo-slice.md §6.2); a code with no words here falls back to the app-wide table in common/messages.ts.
import { errorText } from '../common/messages';

const DRIVE_MESSAGES: Readonly<Record<string, string>> = {
  // E18: the api could not protect the contact details, so it stored nothing (no plaintext fallback).
  crypto_unavailable:
    'Contact details could not be protected just now, so nothing was invited from that batch. Try again in a few minutes.',
  slot_full: 'That slot is full.',
  network: 'The network failed. Check your connection and try again.',
};

export function driveErrorText(code: string): string {
  return DRIVE_MESSAGES[code] ?? errorText(code);
}
