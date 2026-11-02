// The report page makes three independent calls (specs/d1-demo-slice.md §6.1, L-19, rule 1): the header, the
// Answer Quality card and the Integrity Signals card. Each has its own poller and its own contract; nothing
// here reads one card's value to build another.
import { IntegrityCard, QualityCard, ReportMetaResponse } from '@trace/shared/contracts/d1';
import type { ApiClient } from '../api/client';
import { CardPoller } from '../common/poller';
import { StartPhotoController, type PhotoDeps } from './start-photo';

/** Failure codes of the header call that a retry cannot change. */
const TERMINAL_CODES: ReadonlySet<string> = new Set(['not_found', 'aal2_required', 'unauthorized']);
const isTerminalCode = (code: string): boolean => TERMINAL_CODES.has(code);

export class ReportController {
  readonly meta: CardPoller<ReportMetaResponse>;
  readonly quality: CardPoller<QualityCard>;
  readonly integrity: CardPoller<IntegrityCard>;
  readonly photo: StartPhotoController;

  constructor(api: ApiClient, reportId: string, photoDeps?: PhotoDeps) {
    this.meta = new CardPoller<ReportMetaResponse>({
      fetchCard: () =>
        api.call({ method: 'GET', path: `/reports/${reportId}`, schema: ReportMetaResponse }),
      // The header never changes once it is read: one successful answer is final.
      isFinal: () => true,
      // These cannot be fixed by waiting (the report is not there, or the sign-in must be redone).
      isTerminal: isTerminalCode,
    });
    // A terminal header ends the whole page: the cards stop polling too (a card itself never fails).
    this.meta.subscribe(() => {
      if (this.meta.getSnapshot().state.kind === 'terminal') {
        this.quality.stop();
        this.integrity.stop();
      }
    });
    this.quality = new CardPoller<QualityCard>({
      fetchCard: () =>
        api.call({
          method: 'GET',
          path: `/reports/${reportId}/quality`,
          schema: QualityCard,
        }),
      isFinal: (card) => card.state !== 'pending',
    });
    this.integrity = new CardPoller<IntegrityCard>({
      fetchCard: () =>
        api.call({
          method: 'GET',
          path: `/reports/${reportId}/integrity`,
          schema: IntegrityCard,
        }),
      isFinal: (card) => card.state !== 'pending',
    });
    this.photo = new StartPhotoController(api, reportId, photoDeps);
  }

  start(): void {
    this.meta.start();
    this.quality.start();
    this.integrity.start();
  }

  stop(): void {
    this.meta.stop();
    this.quality.stop();
    this.integrity.stop();
  }
}
