/**
 * Coerce an incoming ID (from a request body/param) to a positive integer, or
 * null when it isn't one. IDs from request bodies are interpolated raw into
 * PostgREST filter strings (e.g. `courseID=eq.${id}`); without this a caller
 * could smuggle extra query operators into the filter (PostgREST injection).
 * Passing IDs through here guarantees only a bare integer ever reaches a query.
 */
export function coerceId(value: unknown): number | null {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}
