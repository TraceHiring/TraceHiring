// Which editor a test draft gets on `/tests/:testId` (specs/m1-test-authoring.md R5-69 b) and the conversion of inline
// items between the save request and D1's item form (R5-69 d). Pure functions.
//
// "Stored" integrity settings. `GET …/tests/:testId/integrity` answers D1's equivalent values with `presetKey: null`
// while a draft has none stored (services/api integrity-settings/routes.ts `viewOf`), but `presetKey` is also null for
// stored custom values and for a stored preset an admin lock moved, so the view alone cannot tell them apart. What can:
// whenever settings are stored, the api gives every section a navigation and every written section the paste rule
// (`applySettingsToSections` on PUT …/integrity and on a new draft with locks; every save path stores a null navigation
// as the default, R5-63 b). So the settings count as stored iff the view names a preset, or any section carries a
// navigation or a paste rule. The one case left over (custom settings stored on a draft with no section yet) is shown
// with D1's editor, whose save the api completes the same way (R5-63 b); the next load then shows the v2 editor.
import type { IntegritySettingsView, TestDraftView } from '@trace/shared/contracts/m1';
import { d1Editable, type McqItemForm, type WrittenItemForm } from './editor-model';
import { fromDraftView, type DraftItem, type EditorV2Form } from './editor-v2-model';

export type ItemForm = McqItemForm | WrittenItemForm;

/** Whether the draft's integrity settings are stored (see the header for the rule). */
export function integrityStored(
  detail: TestDraftView,
  integrity: IntegritySettingsView | null,
): boolean {
  return (
    (integrity !== null && integrity.presetKey !== null) ||
    detail.version.sections.some((s) => s.navigation !== null || s.pasteRule !== undefined)
  );
}

/** D1's editor, save and publish keep a draft only while D1 can save it unchanged and no settings are stored. */
export const isD1Shaped = (
  detail: TestDraftView,
  integrity: IntegritySettingsView | null,
): boolean => d1Editable(detail) && !integrityStored(detail, integrity);

/**
 * The v2 form of a stored draft. The integrity values go in only when they are stored: D1's equivalent values of an
 * unstored draft would make it package v2 on its next save (R5-69 b).
 */
export function v2FormOf(
  detail: TestDraftView,
  integrity: IntegritySettingsView | null,
): EditorV2Form {
  const stored = integrity !== null && integrityStored(detail, integrity);
  return fromDraftView(detail, stored ? { paste_written: integrity.values.paste_written } : null);
}

/** The inline items of every section: D1's limit of 10 questions in all applies to them (R5-69 d). */
export const inlineItemCount = (form: EditorV2Form): number =>
  form.sections.reduce((n, s) => n + (s.mode === 'inline' ? s.items.length : 0), 0);

/** A save-request item as D1's item form (text fields; anchors comma-separated). */
export function itemFormOf(item: DraftItem): ItemForm {
  return item.format === 'mcq'
    ? {
        format: 'mcq',
        prompt: item.prompt,
        options: item.options.map((o) => ({ ...o })),
        correctOptionId: item.correctOptionId,
      }
    : {
        format: 'written',
        prompt: item.prompt,
        criteria: item.rubric.criteria.map((c) => ({
          id: c.id,
          label: c.label,
          maxPoints: String(c.maxPoints),
          anchors: c.anchors.join(', '),
          minHits: String(c.minHits),
        })),
      };
}

const toInt = (text: string): number =>
  /^[0-9]{1,9}$/.test(text.trim()) ? Number(text) : Number.NaN;

/**
 * D1's item form as a save-request item, exactly as D1's `toRequest` maps it (trimmed text, anchors split on commas,
 * empty anchors dropped). A number that is not a whole number stays NaN, so the request fails its contract and is
 * never sent.
 */
export function draftItemOf(form: ItemForm): DraftItem {
  return form.format === 'mcq'
    ? {
        format: 'mcq',
        prompt: form.prompt.trim(),
        options: form.options.map((o) => ({ id: o.id, text: o.text.trim() })),
        correctOptionId: form.correctOptionId,
      }
    : {
        format: 'written',
        prompt: form.prompt.trim(),
        rubric: {
          criteria: form.criteria.map((c) => ({
            id: c.id,
            label: c.label.trim(),
            maxPoints: toInt(c.maxPoints),
            anchors: c.anchors
              .split(',')
              .map((a) => a.trim())
              .filter((a) => a !== ''),
            minHits: toInt(c.minHits),
          })),
        },
      };
}
