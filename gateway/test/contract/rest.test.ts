import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONFIGURED, DIRECT, HAS_USERS, NOT_CONFIGURED, TENANT, USER_A, USER_B } from './env';
import { call, GATEWAY, signIn, TARGET, WAYS, type Session, type Way } from './http';

/**
 * Groups 5–9 — `rest/*` (docs/testing.md §3.2). Every call is copied from an adapter, named
 * on the test (§2), in one block per tenant with fixtures: Entrelares' from entrelares-app
 * `app/lib/services/supabase_custody_data_source.dart` at origin/main 7b77cfe (24/09/2026),
 * Desmalha's from desmalha `apps/desmalha_app/lib/` at origin/main 3f5d12b (29/09/2026,
 * card 03.3.2). This directory is the one place a product's tables may be named.
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
const DESMALHA = TENANT === 'desmalha';
const onlyDesmalha = DESMALHA
  ? ''
  : ` [skipped: the calls are Desmalha's adapters'; tenant "${TENANT}" has its own block]`;

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

  describe.skipIf(!DESMALHA)(`Desmalha adapter${onlyDesmalha}`, () => {
    // Local-first: the only rows a Desmalha user owns on the server are the metadata of
    // her encrypted backups, and the one table anyone may read is the public catalogue.
    // catalogo/porta_catalogo_rest.dart:28-36 — GET with the key in apikey AND Bearer:
    const CATALOGUE = '/rest/v1/catalogo_itens?select=tipo,id,conteudo&order=tipo,id';
    // backup/porta_armazenamento_backup_http.dart:100-103 (listarMetadados):
    const METADATA =
      '/rest/v1/backups_metadados?select=seq,path,tamanho_bytes,sha256,formato_versao&order=seq.desc';
    const json = { Accept: 'application/json' };

    /** One backup's metadata, as registrarMetadado sends it after an upload
     * (porta_armazenamento_backup_http.dart:174-188), under a sequence number the app will
     * not reach for decades. The path is the one the table's check constraint demands. */
    const metadata = (uid: string, seq: number) => ({
      seq,
      path: `${uid}/${String(seq).padStart(6, '0')}.dsmb`,
      tamanho_bytes: 133,
      sha256: 'f'.repeat(64),
      formato_versao: 1,
      app_versao: 'fulcrum-contract',
      plataforma: 'android',
    });
    const register = (way: Way, session: Session, seq: number) =>
      call(way, '/rest/v1/backups_metadados', {
        jwt: session.access_token,
        body: metadata(session.user.id, seq),
        headers: { Prefer: 'return=minimal' },
      });
    // removerMetadados (:194-199) — every row the suite writes is removed by its owner.
    const remove = (way: Way, session: Session, seq: number) =>
      call(way, `/rest/v1/backups_metadados?seq=in.(${seq})`, {
        method: 'DELETE',
        jwt: session.access_token,
      });

    describe('group 5 — rest/anon', () => {
      it.each(WAYS)('backup metadata with no session is 401, never 200 [] — $name', async (way) => {
        // listarMetadados with the key alone, as the SDK and the adapters send it pre-login.
        const res = await call(way, METADATA);
        expect(res.status).toBe(401);
        expect(body(res.text).code).toBe('42501');
      });

      it.skipIf(!DIRECT)('the refusal arrives byte for byte (contract §5)', async () => {
        const [through, straight] = await Promise.all([
          call(GATEWAY, METADATA),
          call(TARGET, METADATA),
        ]);
        expect(through.text).toBe(straight.text);
      });

      it.each(WAYS)('the catalogue reads anonymously, as the app reads it — $name', async (way) => {
        const res = await call(way, CATALOGUE, { headers: json });
        expect(res.status).toBe(200);
        const rows = JSON.parse(res.text) as Record<string, unknown>[];
        expect(rows.length).toBeGreaterThan(0);
        expect(Object.keys(rows[0]!).sort()).toEqual(['conteudo', 'id', 'tipo']);
      });

      it.skipIf(!DIRECT)('the catalogue arrives byte for byte — nothing added (§5)', async () => {
        const [through, straight] = await Promise.all([
          call(GATEWAY, CATALOGUE, { headers: json }),
          call(TARGET, CATALOGUE, { headers: json }),
        ]);
        expect(through.text).toBe(straight.text);
      });
    });

    describe('signed in as A and B', () => {
      const sessions = new Map<string, { a: Session; b: Session }>();
      beforeAll(async () => {
        for (const way of WAYS) {
          sessions.set(way.name, { a: await signIn(way, USER_A), b: await signIn(way, USER_B) });
        }
      });
      const a = (way: Way) => sessions.get(way.name)!.a;
      const b = (way: Way) => sessions.get(way.name)!.b;

      describe.each(WAYS)('groups 6 and 7 — rest/rls and rest/error, $name', (way: Way) => {
        // One sequence per way, so the two halves never touch each other's row.
        const seq = way.name === 'gateway' ? 999_901 : 999_902;

        beforeAll(async () => {
          await remove(way, b(way), seq); // a run that died halfway left it behind
          expect((await register(way, b(way), seq)).status).toBe(201);
        });
        afterAll(async () => {
          await remove(way, b(way), seq);
        });

        it("A cannot see B's backups", async () => {
          const res = await call(way, METADATA, { jwt: a(way).access_token });
          expect(res.status).toBe(200);
          const rows = JSON.parse(res.text) as { path: string }[];
          expect(rows.some((row) => row.path.startsWith(`${b(way).user.id}/`))).toBe(false);
        });

        it("A's DELETE of B's backup removes nothing, and B still has it", async () => {
          const res = await call(way, `/rest/v1/backups_metadados?seq=in.(${seq})`, {
            method: 'DELETE',
            jwt: a(way).access_token,
            headers: { Prefer: 'return=representation' },
          });
          expect(res.status).toBe(200);
          expect(JSON.parse(res.text)).toEqual([]);
          const mine = await call(way, METADATA, { jwt: b(way).access_token });
          const rows = JSON.parse(mine.text) as { seq: number }[];
          expect(rows.some((row) => row.seq === seq)).toBe(true);
        });

        it('the same sequence twice is the 409 / 23505 the adapter reads as a conflict', async () => {
          // porta_armazenamento_backup_http.dart:79-84 — `_falha` marks a conflict on 409,
          // `"409"`, Duplicate, already exists or 23505.
          const res = await register(way, b(way), seq);
          expect(res.status).toBe(409);
          expect(body(res.text).code).toBe('23505');
        });
      });

      it.skipIf(!DIRECT)('group 7 — the conflict arrives byte for byte (contract §5)', async () => {
        // B's duplicate of one row, sent through the gateway and directly at once.
        const seq = 999_903;
        await remove(GATEWAY, b(GATEWAY), seq);
        try {
          expect((await register(GATEWAY, b(GATEWAY), seq)).status).toBe(201);
          const [through, straight] = await Promise.all([
            register(GATEWAY, b(GATEWAY), seq),
            register(TARGET, b(TARGET), seq),
          ]);
          expect(through.status).toBe(409);
          expect(through.text).toBe(straight.text);
        } finally {
          await remove(GATEWAY, b(GATEWAY), seq);
        }
      });
    });

    it.skip('groups 8 and 9 — rest/pagination and rest/rpc [skipped for Desmalha: no adapter pages a list, and its one RPC (onboarding/porta_aceite_http.dart:48, registrar_aceite) records a legal acceptance — a write the suite has no business making every night; the Entrelares block holds both promises]', () => {});
  });
});
