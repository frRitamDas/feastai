/** Escape PostgreSQL LIKE wildcards so a search matches literal user input. */
export function escapeSearchTerm(query: string): string {
  return query.replace(/[\\%_]/g, "\\$&");
}
