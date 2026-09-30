import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONFIGURED, DIRECT, HAS_USERS, NOT_CONFIGURED, TENANT, USER_A, USER_B } from './env';
import { GATEWAY, signIn, TARGET, WAYS, type Session, type Way } from './http';

/**
 * Group 11 — `storage` (docs/testing.md §3.2; shaped by card 03.3.1, real since card
 * 03.3.2). Desmalha is the tenant with a bucket, and every call here is copied from its
 * adapter, desmalha `apps/desmalha_app/lib/backup/porta_armazenamento_backup_http.dart` at
 * origin/main 3f5d12b (29/09/2026): the encrypted backup, an opaque `.dsmb` blob in
 * `backups/<uid>/`, uploaded with `x-upsert: false` into a bucket whose UPDATE policy was
 * dropped — a backup is never overwritten, by either side. (The 03.3.1 shape expected an
 * `x-upsert: true` replace; the only app with a bucket forbids it, so the group asserts the
 * refusal instead.)
 *
 * The storage policy judges, never the gateway (R2): B cannot read or write A's folder. The
 * `Range` download is the contract's promise (§2.1 — `Range` passes, `206` and
 * `Content-Range` come back); the adapter downloads whole, so that one assertion is born
 * from the contract. Every object the group writes is removed by the end — the dev bucket
 * must not grow every night.
 */

const DESMALHA = TENANT === 'desmalha';
const skipAll = !CONFIGURED || !HAS_USERS || !DESMALHA;
const why = !CONFIGURED
  ? NOT_CONFIGURED
  : !HAS_USERS
    ? `tenant "${TENANT}" has no fixture users`
    : `tenant "${TENANT}" stores no files — the calls are Desmalha's backup adapter's`;

const BUCKET = 'backups'; // porta_armazenamento_backup_http.dart:33 — static const _balde

/**
 * `_pedir` (porta_armazenamento_backup_http.dart:35-67): raw HTTP with `apikey` and the
 * session's `Bearer`; a binary body goes as `application/octet-stream` (the only type the
 * bucket accepts), a JSON one as `application/json`.
 */
async function ask(
  way: Way,
  session: Session,
  method: string,
  path: string,
  init: { bytes?: Uint8Array; json?: unknown; headers?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = {
    apikey: way.key,
    Authorization: `Bearer ${session.access_token}`,
    ...init.headers,
  };
  let body: BodyInit | undefined;
  if (init.bytes !== undefined) {
    headers['Content-Type'] = 'application/octet-stream';
    body = init.bytes;
  } else if (init.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`${way.base}${path}`, { method, headers, body, redirect: 'manual' });
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, bytes, text: new TextDecoder().decode(bytes) };
}

// enviar (:137-145)
const upload = (way: Way, s: Session, path: string, bytes: Uint8Array) =>
  ask(way, s, 'POST', `/storage/v1/object/${BUCKET}/${path}`, {
    bytes,
    headers: { 'x-upsert': 'false' },
  });
// baixar (:148-151)
const download = (way: Way, s: Session, path: string, headers?: Record<string, string>) =>
  ask(way, s, 'GET', `/storage/v1/object/authenticated/${BUCKET}/${path}`, { headers });
// listarObjetos (:118-133)
const list = (way: Way, s: Session, uid: string) =>
  ask(way, s, 'POST', `/storage/v1/object/list/${BUCKET}`, {
    json: { prefix: uid, limit: 1000, offset: 0 },
  });
// removerObjetos (:154-163)
const removeObjects = (way: Way, s: Session, paths: string[]) =>
  ask(way, s, 'DELETE', `/storage/v1/object/${BUCKET}`, { json: { prefixes: paths } });

/** An opaque blob, random so a stale object can never pass for this run's. */
function blob(): Uint8Array {
  const bytes = new Uint8Array(256);
  crypto.getRandomValues(bytes);
  return bytes;
}

const same = (x: Uint8Array, y: Uint8Array) => Buffer.from(x).equals(Buffer.from(y));

/** `_falha` (:77-90) reads a conflict from any of these — the Storage answers 400 with a
 * `"statusCode":"409"` body for an object that exists. */
const CONFLICT = /"409"|Duplicate|already exists|23505/;

describe.skipIf(skipAll)(`group 11 — storage${skipAll ? ` — skipped: ${why}` : ''}`, () => {
  const sessions = new Map<string, { a: Session; b: Session }>();
  beforeAll(async () => {
    for (const way of WAYS) {
      sessions.set(way.name, { a: await signIn(way, USER_A), b: await signIn(way, USER_B) });
    }
  });
  const a = (way: Way) => sessions.get(way.name)!.a;
  const b = (way: Way) => sessions.get(way.name)!.b;

  describe.each(WAYS)('the encrypted backup, $name', (way: Way) => {
    // One object per way, named like the app's own (`<uid>/<seq>.dsmb`) with a sequence
    // number the app will not reach for decades.
    const seq = way.name === 'gateway' ? '999901' : '999902';
    const own = () => `${a(way).user.id}/${seq}.dsmb`;
    const intruder = () => `${a(way).user.id}/${seq}-b.dsmb`;
    const bytes = blob();

    beforeAll(async () => {
      await removeObjects(way, a(way), [own(), intruder()]); // a run that died halfway
    });
    afterAll(async () => {
      // Folder-scoped DELETE policy: A removes anything in her folder, a stray of B's too.
      await removeObjects(way, a(way), [own(), intruder()]);
    });

    it('uploads with x-upsert: false', async () => {
      const res = await upload(way, a(way), own(), bytes);
      expect(res.status).toBe(200);
    });

    it('a second upload of the same path is refused — a backup is never overwritten', async () => {
      const res = await upload(way, a(way), own(), blob());
      expect(res.status).not.toBe(200);
      expect(res.text).toMatch(CONFLICT);
    });

    it('downloads byte for byte — the stream crossed untouched', async () => {
      const res = await download(way, a(way), own());
      expect(res.status).toBe(200);
      expect(same(res.bytes, bytes)).toBe(true);
    });

    it('a Range download is 206 with the slice and its Content-Range (contract §2.1)', async () => {
      const res = await download(way, a(way), own(), { Range: 'bytes=10-41' });
      expect(res.status).toBe(206);
      expect(res.headers.get('Content-Range')).toBe(`bytes 10-41/${bytes.length}`);
      expect(same(res.bytes, bytes.subarray(10, 42))).toBe(true);
    });

    it("lists the object in A's folder for A, and nothing of it for B", async () => {
      const mine = await list(way, a(way), a(way).user.id);
      expect(mine.status).toBe(200);
      const names = (JSON.parse(mine.text) as { name: string }[]).map((o) => o.name);
      expect(names).toContain(`${seq}.dsmb`);
      const theirs = await list(way, b(way), a(way).user.id);
      expect(theirs.status).toBe(200);
      expect(JSON.parse(theirs.text)).toEqual([]);
    });

    it("B cannot read A's backup", async () => {
      const res = await download(way, b(way), own());
      expect([200, 206]).not.toContain(res.status);
      expect(same(res.bytes, bytes)).toBe(false);
    });

    it("B cannot write into A's folder", async () => {
      const res = await upload(way, b(way), intruder(), blob());
      expect(res.status).not.toBe(200);
    });

    it('A removes it, and it is gone', async () => {
      const res = await removeObjects(way, a(way), [own()]);
      expect(res.status).toBe(200);
      expect((await download(way, a(way), own())).status).not.toBe(200);
    });
  });

  it.skipIf(!DIRECT)("B's refusal arrives byte for byte — gateway equals direct (§5)", async () => {
    const path = `${a(GATEWAY).user.id}/999903.dsmb`;
    await removeObjects(GATEWAY, a(GATEWAY), [path]);
    try {
      expect((await upload(GATEWAY, a(GATEWAY), path, blob())).status).toBe(200);
      const [through, straight] = await Promise.all([
        download(GATEWAY, b(GATEWAY), path),
        download(TARGET, b(TARGET), path),
      ]);
      expect(through.status).toBe(straight.status);
      expect(through.text).toBe(straight.text);
    } finally {
      await removeObjects(GATEWAY, a(GATEWAY), [path]);
    }
  });
});
