// The report page makes three independent calls (specs/d1-demo-slice.md §6.1, L-19, rule 1): the header, the
// Answer Quality card and the Integrity Signals card. Each has its own poller and its own contract; nothing
// here reads one card's value to build another.
import { IntegrityCard, QualityCard, ReportMetaResponse } from '@trace/shared/contracts/d1';
import type { ApiClient } from '../api/client';
import { CardPoller } from '../common/poller';
import { StartPhotoController, type PhotoDeps } from './start-photo';

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
