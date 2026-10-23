// The scored item set of a package v2 session (spec m1 R5-19, R5-47). Red-first stub.

export interface PlanSection {
  id: string;
  drawCount: number | null;
}
export interface PlanItem {
  itemVersionId: string;
  sectionId: string;
  format: string;
  stem: string;
  rubricVersionId: string | null;
  variantId: string | null;
}
export interface DrawnItem extends PlanItem {
  position: number;
}
export interface PlanEntry {
  id: string;
  sectionId: string;
  item: PlanItem | null;
}

export const planScoredItems = (
  _sections: readonly PlanSection[],
  _inline: readonly PlanItem[],
  _drawn: readonly DrawnItem[],
): PlanEntry[] => {
  throw new Error('not_implemented');
};

export const mcqKeyOf = (
  _item: PlanItem,
  _answerKeys: ReadonlyMap<string, string>,
  _variantKeys: ReadonlyMap<string, string>,
): string => {
  throw new Error('not_implemented');
};
