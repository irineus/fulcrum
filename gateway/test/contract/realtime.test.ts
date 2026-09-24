import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONFIGURED, HAS_USERS, NOT_CONFIGURED, TENANT, USER_A } from './env';
import { call, signIn, WAYS, type Way } from './http';

/**
 * Realtime (contract §1.4; card 03.3.1). The one edit of a query string the gateway makes:
 * the browser's WebSocket cannot set headers, so `apikey` travels in the URL, and the
 * gateway swaps the tenant key there for the target's key. A join that the target accepts
 * THROUGH the gateway, with the tenant key in the query, is the proof — the target would
 * refuse the tenant key itself.
 *
 * The channel is the app's, copied from entrelares-app
 * `app/lib/services/supabase_custody_data_source.dart:383-391`:
 *
 *   _client.channel('care_schedules_changes_${_channelSeq++}')
 *     .onPostgresChanges(event: PostgresChangeEvent.all, schema: 'public',
 *                        table: 'care_schedules', callback: (_) => onChange())
 *     .subscribe(...)
 *
 * and the change that fires it is `insertDay` (:244, `CareSchedule.toInsertJson()`), made
 * by user A in her own family on a day ~23 months ahead, deleted at the end (and before, in
 * case an earlier run died between the two). Phoenix protocol vsn 1.0.0, as realtime_client
 * speaks it; heartbeat every 25 s in the app, once here.
 */

const skipAll = !CONFIGURED || !HAS_USERS;
const ENTRELARES = TENANT === 'entrelares';
const why = !CONFIGURED
  ? NOT_CONFIGURED
  : !HAS_USERS
    ? `tenant "${TENANT}" has no fixture users`
    : `the channel is Entrelares' adapter's; tenant "${TENANT}" brings its own when it joins the matrix`;
/** The test's days: ~23 months ahead, inside the app's 24-month window, far from real use. */
const DAY_MIN = 690;
const DAY_SPAN = 20;
const dayIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

interface Frame {
  topic: string;
  event: string;
  payload: Record<string, unknown>;
  ref: string | null;
}

/** A minimal Phoenix client: send frames, await the first frame matching a predicate. */
async function socket(way: Way) {
  const url = `${way.base.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(way.key)}&vsn=1.0.0`;
  const ws = new WebSocket(url);
  const frames: Frame[] = [];
  const waiters: { test: (f: Frame) => boolean; done: (f: Frame) => void }[] = [];
  ws.addEventListener('message', (event) => {
    const frame = JSON.parse(String(event.data)) as Frame;
    frames.push(frame);
    for (const waiter of [...waiters]) {
      if (waiter.test(frame)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.done(frame);
      }
    }
  });
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () =>
      reject(new Error(`realtime ${way.name}: the socket did not open`)),
    );
  });
  let ref = 0;
  return {
    send(topic: string, event: string, payload: Record<string, unknown>) {
      ref += 1;
      ws.send(JSON.stringify({ topic, event, payload, ref: String(ref), join_ref: '1' }));
      return String(ref);
    },
    next(test: (f: Frame) => boolean, what: string, ms = 15_000): Promise<Frame> {
      const seen = frames.find(test);
      if (seen) return Promise.resolve(seen);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`realtime ${way.name}: no ${what} in ${ms} ms`)),
          ms,
        );
        waiters.push({ test, done: (f) => (clearTimeout(timer), resolve(f)) });
      });
    },
    close: () => ws.close(),
  };
}

describe.skipIf(skipAll || !ENTRELARES)(
  `realtime ${skipAll || !ENTRELARES ? `— skipped: ${why}` : ''}`,
  () => {
    describe.each(WAYS)('postgres_changes on care_schedules, $name', (way: Way) => {
      let jwt = '';
      let profileId = 0;
      const cleanup = () =>
        // Only fixture user A's family, only the test's window of days.
        call(
          way,
          `/rest/v1/care_schedules?scheduled_parent_id=eq.${profileId}&schedule_date=gte.${dayIn(DAY_MIN - 1)}&schedule_date=lte.${dayIn(DAY_MIN + DAY_SPAN + 1)}`,
          { method: 'DELETE', jwt },
        );

      beforeAll(async () => {
        const session = await signIn(way, USER_A);
        jwt = session.access_token;
        const me = await call(way, `/rest/v1/profiles?select=id&user_id=eq.${session.user.id}`, {
          jwt,
        });
        profileId = (JSON.parse(me.text) as { id: number }[])[0]!.id;
        await cleanup();
      });
      afterAll(async () => {
        await cleanup();
      });

      it('joins with the tenant key in the query, beats, and receives the INSERT', async () => {
        const rt = await socket(way);
        try {
          const topic = `realtime:care_schedules_changes_0`;
          const joinRef = rt.send(topic, 'phx_join', {
            config: {
              broadcast: { self: false, ack: false },
              presence: { key: '' },
              postgres_changes: [{ event: '*', schema: 'public', table: 'care_schedules' }],
              private: false,
            },
            access_token: jwt,
          });
          const joined = await rt.next(
            (f) => f.event === 'phx_reply' && f.ref === joinRef,
            'join reply',
          );
          expect(joined.payload.status).toBe('ok');
          await rt.next(
            (f) =>
              f.event === 'system' &&
              f.payload.extension === 'postgres_changes' &&
              f.payload.status === 'ok',
            'postgres_changes subscription',
          );

          const beat = rt.send('phoenix', 'heartbeat', {});
          const beatReply = await rt.next(
            (f) => f.event === 'phx_reply' && f.ref === beat,
            'heartbeat reply',
          );
          expect(beatReply.payload.status).toBe('ok');

          // supabase_custody_data_source.dart:244 — insert(day.toInsertJson())
          // The app's own rule (captured 24/09/2026, 23514): "O calendário permite agendar
          // no máximo 24 meses à frente." So a day ~23 months ahead, far from real use, and
          // another one if the family already has that day (one day, one row).
          let inserted = { status: 0, text: '' };
          for (let attempt = 0; attempt < 5 && inserted.status !== 201; attempt++) {
            const when = dayIn(DAY_MIN + Math.floor(Math.random() * DAY_SPAN));
            inserted = await call(way, '/rest/v1/care_schedules', {
              jwt,
              body: {
                schedule_date: when,
                handoff_time: null,
                scheduled_parent_id: profileId,
                actual_parent_id: null,
                notes: null, // captured 24/09/2026 (23514): "A observação do dia virou a agenda."
              },
              headers: { Prefer: 'return=representation' },
            });
          }
          expect(inserted.status, inserted.text).toBe(201);

          const change = await rt.next(
            (f) =>
              f.event === 'postgres_changes' &&
              (f.payload.data as { type?: string; table?: string } | undefined)?.type ===
                'INSERT' &&
              (f.payload.data as { table?: string }).table === 'care_schedules',
            'INSERT event',
          );
          const id = (JSON.parse(inserted.text) as { id: number }[])[0]!.id;
          expect((change.payload.data as { record: { id: number } }).record.id).toBe(id);
        } finally {
          rt.close();
        }
      }, 60_000);
    });
  },
);
