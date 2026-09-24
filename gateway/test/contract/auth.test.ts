import { beforeAll, describe, expect, it } from 'vitest';
import { CONFIGURED, DIRECT, HAS_USERS, NOT_CONFIGURED, TENANT, USER_A, USES_OTP } from './env';
import { call, GATEWAY, signIn, TARGET, WAYS, type Session, type Way } from './http';

/**
 * Groups 2–4 — `auth/*` (docs/testing.md §3.2), each call copied from the adapter it came
 * from. Parity subset (§3.4): every check runs through the gateway and, when the target is
 * configured, directly — the same assertion must hold both ways.
 */

const skipAll = !CONFIGURED || !HAS_USERS;
const why = !CONFIGURED ? NOT_CONFIGURED : `tenant "${TENANT}" has no fixture users`;
const direct = DIRECT ? '' : ' (direct half not run: no TARGET_URL / TARGET_ANON_KEY)';

describe.skipIf(skipAll)(`auth ${skipAll ? `— skipped: ${why}` : direct}`, () => {
  describe.each(WAYS)('group 2 — auth/password, $name', (way: Way) => {
    let session: Session;
    beforeAll(async () => {
      session = await signIn(way, USER_A);
    });

    it('signInWithPassword returns a usable session for user A', () => {
      // entrelares-app app/lib/main.dart:1153
      //   await _client.auth.signInWithPassword(email: email, password: password);
      expect(session.access_token.split('.')).toHaveLength(3);
      expect(session.refresh_token).not.toBe('');
      expect(session.user.email.toLowerCase()).toBe(USER_A.email.toLowerCase());
    });

    it('the session reads the user back — the JWT crossed untouched (contract §2.1)', async () => {
      const res = await call(way, '/auth/v1/user', { jwt: session.access_token });
      expect(res.status).toBe(200);
      expect((res.json as { id: string }).id).toBe(session.user.id);
    });

    it('refreshSession exchanges the refresh token for a new session', async () => {
      // entrelares-app app/lib/services/session_gate.dart:48
      //   final refresh = _auth.refreshSession().then<RestoredSession>(
      // gotrue-dart: POST /auth/v1/token?grant_type=refresh_token {refresh_token}
      const res = await call(way, '/auth/v1/token?grant_type=refresh_token', {
        body: { refresh_token: session.refresh_token },
      });
      expect(res.status).toBe(200);
      const next = res.json as Session;
      expect(next.access_token).not.toBe(session.access_token);
      expect(next.user.id).toBe(session.user.id);
    });
  });

  describe('group 3 — auth/id_token', () => {
    // The native Google flow (Decisions §1, contract §3.4): the gateway blocks the browser
    // redirect with 410 but FORWARDS grant_type=id_token, and a bad token is GoTrue's own
    // 400 — never the gateway's. The call is signInWithIdToken as gotrue-dart sends it;
    // the adapter that will make it is card 02.3's (not written yet on 24/09/2026), so the
    // shape comes from the SDK and the promise from the contract.
    const body = { provider: 'google', id_token: 'fulcrum-contract-not-a-token' };

    it.each(WAYS)(
      'an invalid id_token is 400 from GoTrue, not from the gateway — $name',
      async (way: Way) => {
        const res = await call(way, '/auth/v1/token?grant_type=id_token', { body });
        expect(res.status).toBe(400);
        expect(res.json).not.toHaveProperty('source');
      },
    );

    it.skipIf(!DIRECT)(
      'the refusal arrives byte for byte — gateway body equals direct body (contract §5)',
      async () => {
        const [through, straight] = await Promise.all([
          call(GATEWAY, '/auth/v1/token?grant_type=id_token', { body }),
          call(TARGET, '/auth/v1/token?grant_type=id_token', { body }),
        ]);
        expect(through.text).toBe(straight.text);
      },
    );
  });

  describe('group 4 — auth/otp', () => {
    it.skipIf(!USES_OTP)(
      `the OTP request is accepted${USES_OTP ? '' : ` [skipped: tenant "${TENANT}" does not sign in by GoTrue OTP — no signInWithOtp/verifyOTP in its app (git grep, 24/09/2026); the group runs for Desmalha, porta_auth_supabase.dart, when it joins the matrix]`}`,
      async () => {
        // desmalha lib/.../porta_auth_supabase.dart — signInWithOtp(email: …) →
        // POST /auth/v1/otp {email, create_user:false}. Without an inbox the verify half
        // cannot run against a dev project (docs/testing.md §3.2, the honest limit).
        const res = await call(GATEWAY, '/auth/v1/otp', {
          body: { email: USER_A.email, create_user: false },
        });
        expect(res.status).toBe(200);
      },
    );
  });
});
