// @trace/item-delivery (specs/m1-test-authoring.md §6.5, M1-10, ABH-10): drawSection(), the seeded section draw the
// SessionDO runs at section start. Pure TypeScript: no I/O, no clock, no Math.random (drawSeed hashes with Web
// Crypto).
export const ITEM_DELIVERY_PACKAGE = '@trace/item-delivery';

export { DrawError, drawSection, drawSeed, drawWeight } from './draw.js';
export { difficultyBand } from './difficulty-band.js';
export type { DrawErrorCode, DrawnItem, PackageItem, PackageSection, SectionDraw } from './draw.js';
