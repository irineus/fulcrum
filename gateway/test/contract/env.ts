/**
 * The contract suite's whole configuration: the flat variables of docs/testing.md §3.1,
 * which the workflow maps from a tenant's secrets so no test file ever names a tenant.
 *
 * A tenant without contract secrets does not fail: every group skips, green, and says why
 * (card 03.3, decided by Irineu 24/09/2026). Only Entrelares has fixtures today; Gestão
 * IM360 and Desmalha join the matrix in their own migration cards (onboarding step 5).
 */

const read = (name: string) => (process.env[name] ?? '').trim();

export const TENANT = read('FULCRUM_TENANT');
export const FULCRUM_URL = read('FULCRUM_URL').replace(/\/$/, '');
export const TENANT_KEY = read('FULCRUM_TENANT_KEY');
export const TARGET_URL = read('TARGET_URL').replace(/\/$/, '');
export const TARGET_KEY = read('TARGET_ANON_KEY');

/** One allowed origin of the tenant's dev env, for the CORS assertions (contract §3.5). */
export const ALLOWED_ORIGIN = read('FULCRUM_ALLOWED_ORIGIN');
/** `BLOCK_OAUTH_REDIRECT` of the env under test — the 410 applies only where it is on. */
export const BLOCKS_OAUTH = read('FULCRUM_BLOCK_OAUTH_REDIRECT') === 'true';
/** Whether this tenant's app signs in by GoTrue OTP at all (group 4 applies only then). */
export const USES_OTP = read('FULCRUM_USES_OTP') === 'true';

export const USER_A = {
  email: read('CONTRACT_USER_A_EMAIL'),
  password: read('CONTRACT_USER_A_PASSWORD'),
};
export const USER_B = {
  email: read('CONTRACT_USER_B_EMAIL'),
  password: read('CONTRACT_USER_B_PASSWORD'),
};

/** The gateway and a tenant key: the minimum for any group. */
export const CONFIGURED = FULCRUM_URL !== '' && TENANT_KEY !== '';
/** The parity subset (§3.4) needs the target too. */
export const DIRECT = TARGET_URL !== '' && TARGET_KEY !== '';
export const HAS_USERS = USER_A.email !== '' && USER_B.email !== '';

export const NOT_CONFIGURED = `tenant "${TENANT || '?'}" has no contract secrets yet — it joins the matrix in its migration card (docs/testing.md §4.2)`;
