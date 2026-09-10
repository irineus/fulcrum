import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

/**
 * The configuration gate (card 03.2).
 *
 * `wrangler.toml` and the deploy workflow are the two files where a mistake is invisible
 * until it is in production: a `TENANT_HOST` that disagrees with the custom domain is a
 * deploy that answers `404 unknown_tenant` to its OWN hostname, and a matrix entry with a
 * missing `-dev` is a card branch publishing to a production hostname. Neither is caught
 * by a test of `src/` — the code is right and the configuration is wrong. So the file is
 * read here and checked as data.
 *
 * The dry-run validation of card 01.6 found `TENANT_HOST` missing from every env while
 * the contract had required it since 01.5. That kind of hole is what this file exists for.
 */

const REPO = resolve(__dirname, '../../..');
const TENANTS = ['entrelares', 'gestaoim360', 'desmalha'] as const;

/** The public vars every env must declare — `docs/contract.md` §3.2, Decisions §3. */
const PUBLIC_VARS = [
  'TENANT',
  'TENANT_HOST',
  'TARGET',
  'CANARY',
  'ALLOWED_ORIGINS',
  'BLOCK_OAUTH_REDIRECT',
];

/**
 * Secrets reach a deploy through `wrangler secret put --env <env>` and must never be
 * assigned in the file. Checked against the PARSED vars, not the text: the header names
 * them in prose on purpose, and a gate that greps would forbid documenting them (the
 * lesson of the anti-domain gate failing on its own comment, Decisions §1).
 */
const SECRET_NAMES = [
  'TENANT_PUBLIC_KEY',
  'TARGET_SUPABASE_URL',
  'TARGET_SUPABASE_ANON',
  'TARGET_NEON_URL',
  'TARGET_NEON_ANON',
];

interface EnvBlock {
  routes?: { pattern: string; custom_domain?: boolean }[];
  vars?: Record<string, string>;
}

const config = parseToml(
  readFileSync(resolve(REPO, 'gateway/wrangler.toml'), 'utf8'),
) as unknown as { env: Record<string, EnvBlock | undefined> };
const envs = config.env;

/** Reading a missing env should say which one is missing, not fail a type check. */
function env(name: string): Required<EnvBlock> {
  const block = envs[name];
  if (!block?.vars || !block.routes) throw new Error(`wrangler.toml has no complete [env.${name}]`);
  return { vars: block.vars, routes: block.routes };
}

/** One public var of one env. Absence is a failure with a name, never `undefined`. */
function varOf(name: string, key: string): string {
  const value = env(name).vars[key];
  if (value === undefined) throw new Error(`[env.${name}.vars] has no ${key}`);
  return value;
}

/** The origins an env allows, as a list. Empty means NO web client, never "allow all". */
function originsOf(name: string): string[] {
  return varOf(name, 'ALLOWED_ORIGINS')
    .split(',')
    .filter((origin) => origin.length > 0);
}

/** `entrelares` → production; `entrelares-dev` → dev. The env name carries the flavour. */
const PROD_ENVS = TENANTS.map((t) => t);
const DEV_ENVS = TENANTS.map((t) => `${t}-dev`);
const ALL_ENVS = [...PROD_ENVS, ...DEV_ENVS];

describe('wrangler.toml — six envs, production and dev per tenant', () => {
  it('declares exactly the six envs and nothing else', () => {
    expect(Object.keys(envs).sort()).toEqual([...ALL_ENVS].sort());
  });

  it('has no shared `dev` env left', () => {
    // The single `[env.dev]` was pinned to one tenant, so it isolated nothing and could
    // not be what `api-dev.<product>` fronts for the other two (Decisions §3, 08/09/2026).
    expect(envs).not.toHaveProperty('dev');
  });

  it.each(ALL_ENVS)('%s declares every public var', (name) => {
    expect(Object.keys(env(name).vars).sort()).toEqual([...PUBLIC_VARS].sort());
  });

  it.each(ALL_ENVS)('%s serves exactly one custom domain', (name) => {
    const routes = env(name).routes;
    expect(routes).toHaveLength(1);
    // `custom_domain = true` is what creates the DNS record; a hand-made proxied record
    // makes the deploy fail (docs/tenant-onboarding.md §1).
    expect(routes[0]!.custom_domain).toBe(true);
  });

  it.each(ALL_ENVS)('%s checks Host against the hostname it is routed on', (name) => {
    // The one that cannot be caught in `src/`: the code compares `Host` to `TENANT_HOST`
    // correctly, and the deploy still 404s its own hostname if the two disagree here.
    expect(varOf(name, 'TENANT_HOST')).toBe(env(name).routes[0]!.pattern);
  });

  it.each(ALL_ENVS)('%s names its tenant, not its flavour', (name) => {
    // A tenant is a PRODUCT (Decisions §5): the dev deploy of Entrelares is still
    // `entrelares`, so the `supabase-dev` contract matrix asserts the tenant an app will
    // meet in production. The hostname dialled and `version` are what tell them apart.
    expect(varOf(name, 'TENANT')).toBe(name.replace(/-dev$/, ''));
  });

  it.each(PROD_ENVS)('%s is a production hostname', (name) => {
    expect(varOf(name, 'TENANT_HOST')).toMatch(/^api\.[a-z0-9.-]+$/);
  });

  it.each(DEV_ENVS)('%s is a dev hostname', (name) => {
    expect(varOf(name, 'TENANT_HOST')).toMatch(/^api-dev\.[a-z0-9.-]+$/);
  });

  it.each(DEV_ENVS)('%s can rehearse a target switch', (name) => {
    // `X-Fulcrum-Target` is how a switch is rehearsed (Decisions §3); dev is where
    // rehearsing belongs, so the canary is on in all three.
    expect(varOf(name, 'CANARY')).toBe('true');
  });

  it.each(DEV_ENVS)('%s allows only loopback web origins', (name) => {
    // Decided 08/09/2026: a dev gateway is called by a web client on the developer's
    // machine. Repeating the production origins would let a production build talk to a
    // dev target — the mixture per-tenant dev envs exist to end. Empty means NO web
    // client (Desmalha), never "allow all" — `docs/contract.md` §3.5.
    for (const origin of originsOf(name)) {
      expect(origin).toMatch(/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/);
    }
  });

  it.each(PROD_ENVS)('%s allows only https web origins', (name) => {
    for (const origin of originsOf(name)) {
      expect(origin).toMatch(/^https:\/\//);
    }
  });

  it.each(ALL_ENVS)('%s assigns no secret in the file', (name) => {
    for (const secret of SECRET_NAMES) {
      expect(env(name).vars).not.toHaveProperty(secret);
    }
  });
});

/**
 * The deploy workflow. Card 03.2's gate is two triggers: a push to a card branch deploys
 * only the dev envs, a merge into `main` deploys production behind an approval. The
 * failure that matters is a card branch reaching a production hostname, so the invariant
 * checked is which `--env` each job can name.
 */
const WORKFLOW_PATH = resolve(REPO, '.github/workflows/deploy.yml');
const workflow = parseYaml(readFileSync(WORKFLOW_PATH, 'utf8'));
const jobs = workflow.jobs as Record<string, Record<string, unknown> | undefined>;

/** Same idea as `env()`: a job that vanished should name itself in the failure. */
function job(name: string): Record<string, unknown> {
  const found = jobs[name];
  if (!found) throw new Error(`deploy.yml has no job "${name}"`);
  return found;
}

/**
 * Every `wrangler deploy --env <name>` a job can run, with the matrix placeholder folded
 * back to `<tenant>` — the point is the SHAPE of the env name, which is what separates a
 * dev deploy from a production one.
 */
function deployedEnvs(name: string): string[] {
  const steps = (job(name).steps ?? []) as { run?: string }[];
  return steps
    .flatMap((step) => [
      ...(step.run ?? '').matchAll(/wrangler deploy --env ((?:\$\{\{[^}]+\}\}|\S)+)/g),
    ])
    .map((match) => match[1]!.replace('${{ matrix.tenant }}', '<tenant>'));
}

describe('deploy.yml — two triggers, and dev never reaches production', () => {
  it('fires on main and on card branches only', () => {
    // `claude/**` is here because a cloud session's push proxy accepts only the session's
    // own branch, so a card executed from one never sits on `card/**` (CLAUDE.md).
    expect(workflow.on.push.branches).toEqual(['main', 'card/**', 'claude/**']);
  });

  it('deploys only dev envs from a card branch', () => {
    expect(deployedEnvs('dev')).toEqual(['<tenant>-dev']);
  });

  it('deploys only production envs from main', () => {
    expect(deployedEnvs('production')).toEqual(['<tenant>']);
  });

  it('covers the three tenants in both directions', () => {
    for (const name of ['dev', 'production']) {
      const matrix = (job(name).strategy as { matrix: { tenant: string[] } }).matrix;
      expect(matrix.tenant).toEqual([...TENANTS]);
    }
  });

  it('runs the dev job on every branch but main, and production only on main', () => {
    expect(job('dev').if).toContain("github.ref_name != 'main'");
    expect(job('approve-production').if).toContain("github.ref_name == 'main'");
  });

  it('puts production behind an approval, asked once', () => {
    // The gate is a job of its own so `main` asks once and not once per tenant.
    expect(job('approve-production').environment).toBe('production');
    expect(job('production').needs).toBe('approve-production');
    expect(job('production')).not.toHaveProperty('environment');
  });

  it('lints and tests before anything reaches Cloudflare', () => {
    expect(job('dev').needs).toBe('verify');
    expect(job('approve-production').needs).toBe('verify');
    const runs = ((job('verify').steps ?? []) as { run?: string }[]).map((s) => s.run ?? '');
    expect(runs).toContain('npm run lint');
    expect(runs).toContain('npm test');
  });

  it('never names a secret of the target in the workflow', () => {
    // Only Cloudflare credentials belong here; the target's secrets are `wrangler secret
    // put` and never travel through a workflow file (R2, Decisions §3).
    const text = readFileSync(WORKFLOW_PATH, 'utf8');
    for (const secret of SECRET_NAMES) {
      expect(text).not.toContain(secret);
    }
  });
});

const GITATTRIBUTES_PATH = resolve(REPO, '.gitattributes');

/**
 * The line-ending gate (card 01.9).
 *
 * `core.autocrlf` checks CRLF out on Windows while the index keeps LF, so
 * `prettier --check` — which expects LF — failed on 32 files nobody had touched. The
 * defect belongs in this file for the same reason the two above do, only more so: it is
 * invisible from CI BY CONSTRUCTION. Every runner is Linux, so no run of the workflow,
 * green or red, says anything about the line endings a Windows checkout gets. Deleting
 * `.gitattributes` would cost a person an afternoon and cost CI nothing.
 */
describe('.gitattributes — one line ending, and CI cannot check it', () => {
  const attributes = () => readFileSync(GITATTRIBUTES_PATH, 'utf8');

  it('exists at the repository root', () => {
    // Only the root file applies to the whole tree; one under `gateway/` would leave the
    // workflows, the commit hook and the docs on whatever the platform defaults to.
    expect(existsSync(GITATTRIBUTES_PATH)).toBe(true);
  });

  it('normalizes every path to LF', () => {
    const rules = attributes()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'));
    expect(rules).toContain('* text=auto eol=lf');
  });

  it('never re-enables CRLF for a path', () => {
    // One `eol=crlf` on a later line would win for the paths it matches, and the file
    // would still read as though the rule above covered everything.
    expect(attributes()).not.toContain('eol=crlf');
  });

  it('is itself stored with LF', () => {
    expect(attributes()).not.toMatch(/\r/);
  });

  it('keeps prettier on LF, which is what makes the checkout the thing to fix', () => {
    // Setting `endOfLine` to `auto` or `crlf` in `.prettierrc` would silence the Windows
    // lint by teaching CI on Linux to accept CRLF too — the fix that hides the defect
    // instead of removing it (card 01.9).
    const prettier = JSON.parse(readFileSync(resolve(REPO, 'gateway/.prettierrc'), 'utf8'));
    expect(prettier.endOfLine ?? 'lf').toBe('lf');
  });
});
