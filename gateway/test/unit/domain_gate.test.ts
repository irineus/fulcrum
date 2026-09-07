import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The anti-domain gate (Decisions §2 R5 and §6): Fulcrum shares MECHANISM, never domain.
 *
 *  1. The repository has no `.sql` — migrations and functions live in each app's repo.
 *  2. No product table name appears in `gateway/src/` — the gateway never reads a body,
 *     so it never has a reason to know one. The contract suite (test/contract/) is the
 *     one place that legitimately names them: its assertions are real app calls copied
 *     from the adapters.
 *  3. `service_role` appears nowhere in the gateway's code or configuration (R2): the
 *     user's JWT crosses untouched and RLS is the security.
 *
 * The table list is measured, not guessed: every `CREATE TABLE` in the three products'
 * `supabase/migrations/` on 2026-09-07. When a product adds a table, add it here — a
 * gate that trusts an old list rots quietly.
 */
const PRODUCT_TABLES: Record<string, string[]> = {
  // irineus/entrelares-flutter — supabase/migrations (schema_migrations excluded: PostgREST's own)
  entrelares: [
    'account_logs',
    'activity_logs',
    'app_settings',
    'auth_elevations',
    'billing_events',
    'care_schedules',
    'email_usage',
    'families',
    'family_deletion_requests',
    'family_deletion_responses',
    'family_invitations',
    'notifications',
    'operator_audit_logs',
    'platform_operators',
    'premium_interest',
    'profiles',
    'push_subscriptions',
    'roles',
    'subscriptions',
    'swap_requests',
  ],
  // irineus/gestao-im360 — supabase/migrations
  gestaoim360: [
    'aluno',
    'aluno_material',
    'aluno_material_hist',
    'aluno_status_hist',
    'bloco_aluno',
    'bloco_aluno_reposicao',
    'bloco_horario',
    'combo',
    'combo_curso',
    'curso',
    'curso_material',
    'demanda_projetada',
    'demanda_projetada_hist',
    'material',
    'metodo',
    'modulo',
    'movimento_estoque',
    'parametro',
    'pc',
    'pc_credencial_acesso',
    'pc_manutencao',
    'pedido_compra',
    'pedido_item',
    'pendencia',
    'perfil',
    'perfil_permissao',
    'perfil_permissao_hist',
    'permissao',
    'professor',
    'sala',
    'turma_modular',
    'turma_modular_aluno',
    'turma_modular_modulo',
    'unidade',
    'usuario',
    'usuario_perfil',
  ],
  // irineus/desmalha — supabase/migrations
  desmalha: ['aceites_termos', 'catalogo_itens', 'perfis'],
};

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const GATEWAY = resolve(__dirname, '..', '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.wrangler', 'dist']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const rel = (file: string) => relative(REPO_ROOT, file).replaceAll('\\', '/');

describe('anti-domain gate', () => {
  it('the repository carries no .sql — migrations belong to the apps (R1, R5)', () => {
    const sql = walk(REPO_ROOT).filter((f) => f.toLowerCase().endsWith('.sql'));
    expect(sql.map(rel)).toEqual([]);
  });

  it('gateway/src names no product table (R5)', () => {
    const sources = walk(join(GATEWAY, 'src')).filter((f) => f.endsWith('.ts'));
    const hits: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, 'utf8');
      for (const [product, tables] of Object.entries(PRODUCT_TABLES)) {
        for (const table of tables) {
          if (new RegExp(`\\b${table}\\b`).test(text))
            hits.push(`${rel(file)}: ${table} (${product})`);
        }
      }
    }
    expect(hits, 'domain leaked into the gateway — fix the port, not the list').toEqual([]);
  });

  it('service_role appears nowhere in the gateway code or config (R2)', () => {
    const files = [
      ...walk(join(GATEWAY, 'src')),
      join(GATEWAY, 'wrangler.toml'),
      join(GATEWAY, 'package.json'),
    ];
    const hits = files.filter((f) => /service[_-]?role/i.test(readFileSync(f, 'utf8')));
    expect(hits.map(rel)).toEqual([]);
  });
});
