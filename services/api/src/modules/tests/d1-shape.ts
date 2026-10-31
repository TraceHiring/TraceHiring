// Whether D1's `PUT …/tests/:testId` may overwrite a stored draft (spec m1 R5-70 b). D1's request maps to inline
// sections with navigation null, one per format, so it would silently drop anything else (a pool, shuffle, a timer, a
// blueprint, a second section of a format). The api's mirror of the recruiter editor's `d1Editable`
// (apps/recruiter/src/authoring/editor-model.ts; packages cannot share it): every section inline, unshuffled, untimed,
// without a blueprint, with no navigation or its format's default (a draft with stored settings has the default and
// its written section the paste rule, R5-63 b, which D1's save keeps), and at most one section per format.
import { defaultNavigation } from './draft.js';

export interface ShapeSection {
  mode: 'inline' | 'pool';
  format: 'mcq' | 'written';
  shuffleItems: boolean;
  shuffleOptions: boolean;
  navigation: 'free' | 'forward_only' | null;
  timeLimitSeconds?: number | undefined;
  blueprint?: unknown;
  pasteRule?: string | undefined;
}

export function d1Shaped(sections: readonly ShapeSection[]): boolean {
  const formats = new Set(sections.map((s) => s.format));
  return (
    formats.size === sections.length &&
    sections.every(
      (s) =>
        s.mode === 'inline' &&
        !s.shuffleItems &&
        !s.shuffleOptions &&
        s.timeLimitSeconds === undefined &&
        s.blueprint === undefined &&
        (s.navigation === null || s.navigation === defaultNavigation(s.format)),
    )
  );
}
