// The AI draft request form as an AiDraftRequest (specs/m1-test-authoring.md §6.4). The topic is free text: it is
// sent as written, and the api scrubs it and passes it to the drafter as delimited data (E21).
import { AiDraftRequest, type ItemFormat } from '@trace/shared/contracts/m1';
import type { FieldError } from './item-form';

export interface AiDraftForm {
  format: ItemFormat;
  skillKey: string;
  difficulty: string;
  count: string;
  topic: string;
}

export const EMPTY_AI_FORM: AiDraftForm = {
  format: 'mcq',
  skillKey: '',
  difficulty: '',
  count: '3',
  topic: '',
};

const MESSAGES: Readonly<Record<string, string>> = {
  skillKey: 'A skill is lower-case letters, digits and underscores.',
  difficulty: 'Difficulty is a number from 0 to 1 in steps of 0.01.',
  count: 'Choose 1 to 10 drafts.',
  topic: 'Describe the topic (1 to 500 characters).',
};

const DECIMAL = /^\d*\.?\d+$/;
const WHOLE = /^\d+$/;
const numberOrText = (value: string, pattern: RegExp): number | string =>
  pattern.test(value.trim()) ? Number(value.trim()) : value;

export type AiRequestResult =
  { ok: true; request: AiDraftRequest } | { ok: false; errors: FieldError[] };

export function toAiRequest(form: AiDraftForm): AiRequestResult {
  const parsed = AiDraftRequest.safeParse({
    format: form.format,
    skillKey: form.skillKey.trim(),
    difficulty: numberOrText(form.difficulty, DECIMAL),
    count: numberOrText(form.count, WHOLE),
    topic: form.topic,
  });
  if (parsed.success) return { ok: true, request: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => {
      const path = issue.path.map(String).join('.');
      return { path, message: MESSAGES[path] ?? 'Check this value.' };
    }),
  };
}
