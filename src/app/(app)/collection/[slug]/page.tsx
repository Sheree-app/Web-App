/**
 * Compatibility alias for the mobile app's existing collection links.
 *
 * The mobile app and old website use /collection/:slug, while the web app's
 * current browse screen is implemented at /category/:slug. Keep the old URL
 * alive so installed apps and previously shared links continue to resolve.
 */
export { default } from "../../category/[slug]/page";
