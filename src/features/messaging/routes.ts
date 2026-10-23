/** `/messages/<id>` → `<id>`; anything else (including `/messages`) → null. */
export function conversationIdFromPath(pathname: string | null): string | null {
  if (!pathname) return null;
  const match = /^\/messages\/([^/?#]+)/.exec(pathname);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** The canonical deep-link target for a thread, shared by links and pushes. */
export function conversationHref(conversationId: string): string {
  return `/messages/${encodeURIComponent(conversationId)}`;
}
