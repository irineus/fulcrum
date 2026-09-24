import { beforeAll, describe, expect, it } from 'vitest';
import { CONFIGURED, DIRECT, HAS_USERS, NOT_CONFIGURED, TENANT, USER_A, USER_B } from './env';
import { call, GATEWAY, signIn, TARGET, WAYS, type Session, type Way } from './http';

/**
 * Groups 5–9 — `rest/*` (docs/testing.md §3.2). Every call is copied from an adapter, named
 * on the test (§2). Today only Entrelares has fixtures, so the calls are Entrelares' — from
 * entrelares-app `app/lib/services/supabase_custody_data_source.dart` at origin/main
 * 7b77cfe (24/09/2026). This directory is the one place a product's tables may be named.
 *
 * Parity subset (§3.4): each group runs through the gateway and directly, and where a body
 * can be compared the two must be equal byte for byte — the gateway adds nothing (§5).
 */

const skipAll = !CONFIGURED || !HAS_USERS;
const why = !CONFIGURED ? NOT_CONFIGURED : `tenant "${TENANT}" has no fixture users`;
const ENTRELARES = TENANT === 'entrelares';
const onlyEntrelares = ENTRELARES
  ? ''
  : ` [skipped: the calls are Entrelares' adapter's; tenant "${TENANT}" brings its own when it joins the matrix]`;

interface Profile {
  id: number;
  user_id: string | null;
  family_id: number;
  full_name: string;
}

const body = (text: string) => JSON.parse(text) as { code?: string; message?: string };

describe.skipIf(skipAll)(`rest ${skipAll ? `— skipped: ${why}` : ''}`, () => {
  describe.skipIf(!ENTRELARES)(`Entrelares adapter${onlyEntrelares}`, () => {
    const sessions = new Map<string, { a: Session; b: Session }>();
    beforeAll(async () => {
      for (const way of WAYS) {
        sessions.set(way.name, { a: await signIn(way, USER_A), b: await signIn(way, USER_B) });
      }
    });
    const a = (way: Way) => sessions.get(way.name)!.a.access_token;
    const b = (way: Way) => sessions.get(way.name)!.b.access_token;
    const bUid = (way: Way) => sessions.get(way.name)!.b.user.id;

    describe('group 5 — rest/anon', () => {
      // supabase_custody_data_source.dart:48
      //   final rows = await _client.from('profiles').select();
      // with no user signed in: the key alone, as the SDK sends it before login.
      it.each(WAYS)('an anonymous read is 401, never 200 [] — $name', async (way: Way) => {
        const res = await call(way, '/rest/v1/profiles?select=*');
        expect(res.status).toBe(401);
        expect(body(res.text).code).toBe('42501');
      });

      it.skipIf(!DIRECT)('the refusal arrives byte for byte (contract §5)', async () => {
        const [through, straight] = await Promise.all([
          call(GATEWAY, '/rest/v1/profiles?select=*'),
          call(TARGET, '/rest/v1/profiles?select=*'),
        ]);
        expect(through.text).toBe(straight.text);
      });
    });

    describe.each(WAYS)('group 6 — rest/rls, $name', (way: Way) => {
      let own: Profile;
      beforeAll(async () => {
        // supabase_custody_data_source.dart:57-59
        //   .from('profiles').select().eq('user_id', uid)
        const res = await call(way, `/rest/v1/profiles?select=*&user_id=eq.${bUid(way)}`, {
          jwt: b(way),
        });
        expect(res.status).toBe(200);
        own = (JSON.parse(res.text) as Profile[])[0]!;
        expect(own).toBeDefined();
      });

      it("A cannot see B's family", async () => {
        // supabase_custody_data_source.dart:48 — _client.from('profiles').select()
        const res = await call(way, '/rest/v1/profiles?select=*', { jwt: a(way) });
        expect(res.status).toBe(200);
        const rows = JSON.parse(res.text) as Profile[];
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.some((row) => row.family_id === own.family_id)).toBe(false);
      });

      it("A's UPDATE of B's profile affects 0 rows and leaves the row intact", async () => {
        // supabase_custody_data_source.dart:1674-1675
        //   .from('profiles').update({'full_name': fullName.trim()}).eq('id', profileId);
        // The value written is B's CURRENT name, so a broken policy would still change
        // nothing visible — the row count is what proves the isolation.
        const res = await call(way, `/rest/v1/profiles?id=eq.${own.id}`, {
          method: 'PATCH',
          jwt: a(way),
          body: { full_name: own.full_name },
          headers: { Prefer: 'return=representation' },
        });
        expect(res.status).toBe(200);
        expect(JSON.parse(res.text)).toEqual([]);
        const again = await call(way, `/rest/v1/profiles?select=*&id=eq.${own.id}`, {
          jwt: b(way),
        });
        expect((JSON.parse(again.text) as Profile[])[0]).toEqual(own);
      });
    });

    describe('groups 7 and 9 — rest/error and rest/rpc', () => {
      // supabase_custody_data_source.dart:1695-1696
      //   await _client.rpc('set_member_admin',
      //       params: {'p_profile_id': profileId, 'p_is_admin': isAdmin});
      // A is her family's admin with no sudo window, so the function raises before any
      // UPDATE; profile -1 exists nowhere, so nothing could change in any case.
      const params = { p_profile_id: -1, p_is_admin: false };
      // Captured from the target, 24/09/2026 — the migration's own RAISE text, which the
      // app detects by its prefix (FamilyService / runWithSudo).
      const ELEVATION =
        'ELEVATION_REQUIRED: Confirme sua senha para alterar permissões de administrador.';

      it.each(WAYS)('ELEVATION_REQUIRED: reaches the app intact — $name', async (way: Way) => {
        const res = await call(way, '/rest/v1/rpc/set_member_admin', { jwt: a(way), body: params });
        expect(res.status).toBe(403);
        expect(body(res.text)).toMatchObject({ code: '42501', message: ELEVATION });
      });

      it.skipIf(!DIRECT)(
        'the error arrives byte for byte — gateway equals direct (contract §5)',
        async () => {
          const [through, straight] = await Promise.all([
            call(GATEWAY, '/rest/v1/rpc/set_member_admin', { jwt: a(GATEWAY), body: params }),
            call(TARGET, '/rest/v1/rpc/set_member_admin', { jwt: a(TARGET), body: params }),
          ]);
          expect(through.text).toBe(straight.text);
        },
      );

      it.each(WAYS)('a read-only RPC answers — $name', async (way: Way) => {
        // supabase_custody_data_source.dart:151
        //   final data = await _client.rpc('get_billing_history');
        const res = await call(way, '/rest/v1/rpc/get_billing_history', { jwt: a(way), body: {} });
        expect(res.status).toBe(200);
        expect(Array.isArray(JSON.parse(res.text))).toBe(true);
      });
    });

    describe.each(WAYS)('group 8 — rest/pagination, $name', (way: Way) => {
      // supabase_custody_data_source.dart:1908-1912
      //   .from('activity_logs').select().order('created_at', ascending: false)
      //       .range(offset, offset + auditPageSize - 1);   // auditPageSize = 20
      // postgrest-dart sends range() as offset/limit query parameters.
      const page = '/rest/v1/activity_logs?select=*&order=created_at.desc&offset=0&limit=20';

      it('the page arrives with a Content-Range that matches it', async () => {
        const res = await call(way, page, { jwt: a(way) });
        expect(res.status).toBe(200);
        const rows = JSON.parse(res.text) as unknown[];
        expect(rows.length).toBeLessThanOrEqual(20);
        const range = res.headers.get('Content-Range');
        expect(range).toBe(rows.length === 0 ? '*/*' : `0-${rows.length - 1}/*`);
      });

      it('Prefer: count=exact and a Range header take effect (contract §2.1)', async () => {
        const res = await call(way, '/rest/v1/activity_logs?select=*&order=created_at.desc', {
          jwt: a(way),
          headers: { Prefer: 'count=exact', Range: '0-0', 'Range-Unit': 'items' },
        });
        expect([200, 206]).toContain(res.status);
        const rows = JSON.parse(res.text) as unknown[];
        expect(rows.length).toBeLessThanOrEqual(1);
        expect(res.headers.get('Content-Range')).toMatch(/^(0-0|\*)\/\d+$/);
      });
    });
  });
});
