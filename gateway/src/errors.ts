/**
 * The four errors the gateway itself produces, plus the CORS refusal (docs/contract.md §3).
 * Everything else in a response came from the target — that is the contract's most useful
 * property, and the envelope is what makes it checkable: `source: 'fulcrum'` says the
 * gateway answered and the target was never contacted.
 */
export type ErrorCode =
  | 'unknown_tenant'
  | 'unknown_route'
  | 'invalid_tenant_key'
  | 'oauth_redirect_blocked'
  | 'origin_not_allowed';

const STATUS: Record<ErrorCode, number> = {
  unknown_tenant: 404,
  unknown_route: 404,
  invalid_tenant_key: 401,
  oauth_redirect_blocked: 410,
  origin_not_allowed: 403,
};

/** `{error, source: 'fulcrum'}` and at most a `hint` — nothing else is in the envelope. */
export function fulcrumError(code: ErrorCode, hint?: string): Response {
  return Response.json(
    hint === undefined
      ? { error: code, source: 'fulcrum' }
      : { error: code, source: 'fulcrum', hint },
    { status: STATUS[code] },
  );
}
