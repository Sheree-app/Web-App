/**
 * This page reads its query string (`useSearchParams`) at the top level. Since
 * the root layout stopped reading cookies, pages can be prerendered, and this
 * one would then render blank until its JavaScript loads. Rendering it per
 * request keeps the full page in the first HTML, as it always was.
 */
export const dynamic = "force-dynamic";

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
