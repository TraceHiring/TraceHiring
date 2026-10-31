// @vitest-environment happy-dom
// `/drives/:driveId/upload` (specs/m2-scheduling-invites.md §6.2, M2-6, M2-7, R2-12, R5-20, R5-59): pick a CSV, see the
// rows in the file, send it in batches through the api client, see who was invited and which rows were refused,
// mark held phone-shared rows as different people, cancel. A fake fetch stands in for the api. Synthetic data only.
import type { InviteBatchRequest, InviteRow } from '@trace/shared/contracts/m2';
import { createHash } from 'node:crypto';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  failure,
  fakeApi,
  info,
  type FakeAnswer,
  type FakeCall,
} from '../../bank/testing/api.test-helpers';
import { mountScreen, type Mounted } from '../../bank/testing/dom.test-helpers';
import { DriveUploadRoute } from '../DriveRoutes';
import { HEADER, csvOf, csvRow, uid, uploadView } from '../testing/fixtures.test-helpers';
import { ROW_REASON_TEXT } from './texts';

const DRIVE = uid(101);
const UPLOAD = uploadView().uploadId;
let mounted: Mounted | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  vi.restoreAllMocks();
});

type Decide = (row: InviteRow, request: InviteBatchRequest) => 'invited' | string;

function uploadApi(
  decide: Decide = () => 'invited',
  extra?: (call: FakeCall) => FakeAnswer | undefined,
) {
  return fakeApi((call) => {
    const forced = extra?.(call);
    if (forced !== undefined) return forced;
    if (call.method === 'POST' && call.path === `/drives/${DRIVE}/uploads`) {
      return { status: 201, body: uploadView({ driveId: DRIVE }) };
    }
    if (call.method === 'POST' && call.path === `/drives/${DRIVE}/uploads/${UPLOAD}/rows`) {
      const request = call.body as InviteBatchRequest;
      return {
        body: {
          results: request.rows.map((row) => {
            const verdict = decide(row, request);
            return verdict === 'invited'
              ? { rowNo: row.rowNo, invitationId: uid(7000 + row.rowNo) }
              : { rowNo: row.rowNo, reason: verdict, held: verdict === 'phone_shared' };
          }),
        },
      };
    }
    if (call.method === 'POST' && call.path.endsWith('/complete')) {
      return { body: uploadView({ driveId: DRIVE, status: 'completed' }) };
    }
    if (call.method === 'POST' && call.path.endsWith('/cancel')) {
      return { body: uploadView({ driveId: DRIVE, status: 'cancelled' }) };
    }
    return undefined;
  });
}

const mountUpload = (api: ReturnType<typeof uploadApi>['api'] | null) =>
  mountScreen(<DriveUploadRoute />, {
    api,
    info: info('recruiter'),
    at: `/drives/${DRIVE}/upload`,
    path: '/drives/:driveId/upload',
  });

async function pickFile(
  el: Mounted,
  content: string | Uint8Array<ArrayBuffer>,
  name = 'people.csv',
) {
  const input = el.container.querySelector('input[type="file"]');
  const file = new File([content], name, { type: 'text/csv' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input?.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // Reading the bytes and hashing them are real asynchronous work: wait (in real time) until the screen has moved on.
  for (let i = 0; i < 100 && el.text().includes('Reading the file'); i += 1) {
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
      });
    });
  }
  await el.settle();
}

const FILE = csvOf(HEADER, csvRow(1), csvRow(2), csvRow(3));

describe('before a file is chosen', () => {
  it('shows the heading, the expected columns as text, and a CSV-only picker with no template link', async () => {
    const { api, calls } = uploadApi();
    mounted = await mountUpload(api);
    const text = mounted.text();
    expect(text).toContain('Invite candidates');
    for (const column of [
      'full_name',
      'email',
      'phone',
      '18_or_older',
      'slot_starts_at',
      'language',
    ]) {
      expect(text).toContain(column);
    }
    expect(mounted.container.querySelector('input[type="file"]')?.getAttribute('accept')).toBe(
      'text/csv',
    );
    expect(mounted.maybeButton('Start upload')).toBeNull();
    expect(mounted.links()).toContain(`/drives/${DRIVE}`);
    expect(calls).toEqual([]);
  });

  it('renders with no api client (no sign-in yet) without touching the network', async () => {
    mounted = await mountUpload(null);
    expect(mounted.text()).toContain('Invite candidates');
  });
});

describe('a file that cannot be used', () => {
  it('refuses a .xlsx with the CSV message and sends nothing', async () => {
    const { api, calls } = uploadApi();
    mounted = await mountUpload(api);
    await pickFile(mounted, new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), 'people.xlsx');
    expect(mounted.text()).toContain('Save the sheet as CSV and upload that');
    expect(mounted.maybeButton('Start upload')).toBeNull();
    expect(calls).toEqual([]);
  });

  it('refuses a date-of-birth column with "Use the 18-or-older column" and sends nothing', async () => {
    const { api, calls } = uploadApi();
    mounted = await mountUpload(api);
    await pickFile(mounted, csvOf(`${HEADER},dob`, `${csvRow(1)},2001-01-01`));
    expect(mounted.text()).toContain('Use the 18-or-older column');
    expect(calls).toEqual([]);
  });

  it('refuses an unknown column, naming the reason in plain words', async () => {
    const { api, calls } = uploadApi();
    mounted = await mountUpload(api);
    await pickFile(mounted, csvOf(`${HEADER},city`, `${csvRow(1)},Pune`));
    expect(mounted.text()).toContain('a column this screen does not know');
    expect(mounted.text()).not.toContain('unknown_column');
    expect(calls).toEqual([]);
  });

  it('lets the recruiter choose another file after a refusal', async () => {
    const { api } = uploadApi();
    mounted = await mountUpload(api);
    await pickFile(mounted, new Uint8Array([0x50, 0x4b, 0x03, 0x04]), 'people.xlsx');
    await pickFile(mounted, FILE);
    expect(mounted.text()).not.toContain('Save the sheet as CSV');
    expect(mounted.text()).toContain('Rows in file: 3');
  });
});

describe('sending a file', () => {
  it('shows the rows in the file (never "total"), then sends the hash, the rows, and finishes', async () => {
    const { api, calls } = uploadApi();
    mounted = await mountUpload(api);
    await pickFile(mounted, FILE);
    expect(mounted.text()).toContain('Rows in file: 3');
    expect(mounted.text()).not.toMatch(/\btotal\b/i);
    expect(calls).toEqual([]);

    await mounted.click(mounted.button('Start upload'));
    await mounted.settle();

    const create = calls.find((c) => c.path === `/drives/${DRIVE}/uploads`);
    expect(create?.body).toEqual({
      fileSha256: createHash('sha256').update(FILE).digest('hex'),
      rowsInFile: 3,
    });
    const rows = calls.filter((c) => c.path === `/drives/${DRIVE}/uploads/${UPLOAD}/rows`);
    expect(rows).toHaveLength(1);
    const body = rows[0]?.body as InviteBatchRequest;
    expect(body.uploadId).toBe(UPLOAD);
    expect(body.rows.map((row) => row.rowNo)).toEqual([1, 2, 3]);
    expect(body.rows[0]).toMatchObject({ email: 'person1@example.test', adult18: 'yes' });
    expect(calls.at(-1)?.path).toBe(`/drives/${DRIVE}/uploads/${UPLOAD}/complete`);

    const text = mounted.text();
    expect(text).toMatch(/Invited: 3/);
    expect(text).not.toContain('person1@example.test');
    expect(mounted.maybeButton('Mark as different people')).toBeNull();
  });

  it('lists a row the browser could not use and a row the api refused, each with its reason and no value', async () => {
    const { api, calls } = uploadApi((row) => (row.rowNo === 3 ? 'already_invited' : 'invited'));
    mounted = await mountUpload(api);
    await pickFile(
      mounted,
      csvOf(HEADER, csvRow(1), 'Asha Rao,asha@example.test,,maybe,,', csvRow(3)),
    );
    await mounted.click(mounted.button('Start upload'));
    const sent = calls.find((c) => c.path.endsWith('/rows'))?.body as InviteBatchRequest;
    expect(sent.rows.map((row) => row.rowNo)).toEqual([1, 3]);
    const text = mounted.text();
    expect(text).toMatch(/Invited: 1/);
    expect(text).toContain(ROW_REASON_TEXT.bad_adult_value);
    expect(text).toContain(ROW_REASON_TEXT.already_invited);
    expect(text).not.toContain('asha@example.test');
    expect(text).not.toContain('bad_adult_value');
  });

  it('holds phone-shared rows, then re-sends exactly those rows with the flag on "Mark as different people"', async () => {
    const { api, calls } = uploadApi((row, request) =>
      request.confirmPhoneDuplicate === true || row.rowNo !== 2 ? 'invited' : 'phone_shared',
    );
    mounted = await mountUpload(api);
    await pickFile(mounted, FILE);
    await mounted.click(mounted.button('Start upload'));
    expect(mounted.text()).toContain(ROW_REASON_TEXT.phone_shared);
    expect(calls.some((c) => c.path.endsWith('/complete'))).toBe(false);

    await mounted.click(mounted.button('Mark as different people'));
    const rows = calls.filter((c) => c.path.endsWith('/rows'));
    expect(rows).toHaveLength(2);
    const again = rows[1]?.body as InviteBatchRequest;
    expect(again.confirmPhoneDuplicate).toBe(true);
    expect(again.rows.map((row) => row.rowNo)).toEqual([2]);
    expect(again.rows[0]?.email).toBe('person2@example.test');
    expect(calls.at(-1)?.path.endsWith('/complete')).toBe(true);
    expect(mounted.text()).toMatch(/Invited: 3/);
    expect(mounted.maybeButton('Mark as different people')).toBeNull();
  });

  it('can finish leaving held rows uninvited', async () => {
    const { api, calls } = uploadApi((row) => (row.rowNo === 2 ? 'phone_shared' : 'invited'));
    mounted = await mountUpload(api);
    await pickFile(mounted, FILE);
    await mounted.click(mounted.button('Start upload'));
    await mounted.click(mounted.button('Finish upload'));
    expect(calls.at(-1)?.path.endsWith('/complete')).toBe(true);
    expect(mounted.text()).toMatch(/Invited: 2/);
  });

  it('says why in plain words when the upload cannot be opened', async () => {
    const { api } = uploadApi(undefined, (call) =>
      call.path === `/drives/${DRIVE}/uploads` ? failure(503, 'crypto_unavailable') : undefined,
    );
    mounted = await mountUpload(api);
    await pickFile(mounted, FILE);
    await mounted.click(mounted.button('Start upload'));
    expect(mounted.text()).not.toContain('crypto_unavailable');
    expect(mounted.container.querySelector('[role="alert"]')?.textContent).toMatch(/\S{3}/);
    expect(mounted.maybeButton('Choose another file')).not.toBeNull();
  });

  it('cancels with "Cancel upload" and keeps who was invited', async () => {
    const { api, calls } = uploadApi((row) => (row.rowNo === 1 ? 'phone_shared' : 'invited'));
    mounted = await mountUpload(api);
    await pickFile(mounted, FILE);
    await mounted.click(mounted.button('Start upload'));
    await mounted.click(mounted.button('Cancel upload'));
    expect(calls.at(-1)?.path).toBe(`/drives/${DRIVE}/uploads/${UPLOAD}/cancel`);
    expect(mounted.text()).toMatch(/Invited: 2/);
    expect(mounted.text()).toContain('Upload cancelled');
  });
});

describe('what the screen leaves behind (nothing from the file)', () => {
  it('writes nothing to the console, storage or the address bar during a whole upload', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );
    const before = window.location.href;
    const { api } = uploadApi((row) => (row.rowNo === 2 ? 'phone_shared' : 'invited'));
    mounted = await mountUpload(api);
    await pickFile(mounted, FILE);
    await mounted.click(mounted.button('Start upload'));
    await mounted.click(mounted.button('Mark as different people'));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(window.location.href).toBe(before);
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
  });

  it('keeps no value of the file in the page after the upload, only counts and reasons', async () => {
    const { api } = uploadApi((row) => (row.rowNo === 2 ? 'already_invited' : 'invited'));
    mounted = await mountUpload(api);
    await pickFile(mounted, FILE);
    await mounted.click(mounted.button('Start upload'));
    const html = mounted.container.innerHTML;
    for (const value of ['person1@example.test', 'person2@example.test', 'Person A', 'Person B']) {
      expect(html).not.toContain(value);
    }
  });
});
