/** Cursor list helper for `{data, meta: {next_cursor, prev_cursor, limit}}` (13 §16). */
export interface CursorMeta {
  next_cursor: string | null;
  prev_cursor: string | null;
  limit: number;
}
export interface CursorPage<T> {
  data: T[];
  meta: CursorMeta;
}

/** Follows `next_cursor` until exhausted (or `maxPages`), for screens that need the whole set (chart of accounts). */
export async function fetchAllPages<T>(
  fetchPage: (cursor: string | undefined) => Promise<CursorPage<T>>,
  maxPages = 50,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(cursor);
    out.push(...page.data);
    if (!page.meta.next_cursor) return out;
    cursor = page.meta.next_cursor;
  }
  throw new Error(`List did not finish within ${maxPages} pages`);
}

/** Options for React Query's useInfiniteQuery over a cursor endpoint. */
export const cursorPaging = {
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (last: CursorPage<unknown>): string | undefined => last.meta.next_cursor ?? undefined,
};
