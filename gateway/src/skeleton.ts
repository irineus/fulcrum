/**
 * Skeleton markers. Every route module answers 501 with the card that owns its logic
 * until that card lands; the dispatcher in index.ts is the only thing that is real.
 * Grep for `notImplemented(` to see what is still on paper.
 */
export function notImplemented(card: string): Response {
  return Response.json(
    { error: 'not_implemented', card, hint: `See board card ${card}.` },
    { status: 501 },
  );
}

export class NotImplementedError extends Error {
  constructor(public readonly card: string) {
    super(`Not implemented yet — board card ${card}.`);
    this.name = 'NotImplementedError';
  }
}
