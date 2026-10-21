import type { AuthConfig } from 'convex/server';

/**
 * Convex verifies the Supabase access token directly, so a Sheree user's
 * messaging identity is their Supabase `auth.uid()` — the same id used by
 * bookings, profiles and notifications. Nothing in the messaging backend reads
 * the app's Customer/Professional mode.
 *
 * WHY `type: "customJwt"` AND NOT THE OIDC `domain` FORM
 * -----------------------------------------------------
 * `AuthProvider` accepts two shapes. The compact one — `{ domain, applicationID }`
 * — is documented as "the domain of the OIDC auth provider", and Convex treats it
 * as an OIDC provider: it runs discovery and validates an **OIDC ID token**.
 * A Supabase **access token** is an ordinary signed JWT, not an ID token, so that
 * path rejects it with:
 *
 *     Could not parse as OIDC ID token. Token might not be an OIDC-compliant JWT.
 *
 * The `customJwt` form verifies the signature against the issuer's JWKS and then
 * checks `iss` and `aud` — precisely the checks a Supabase access token can pass.
 * (Convex supports only RS256 and ES256 here; Supabase's legacy HS256 shared
 * secret cannot be verified at all, which is why a session minted before the
 * project's key rotation can never authenticate.)
 *
 * The issuer is derived from `SUPABASE_URL` — which is required anyway for the
 * service-role calls — because the Convex CLI statically rejects a deploy when a
 * `process.env.*` referenced in this file is unset, so a second, derivable
 * variable would only be another way to block a deployment.
 *
 * Supabase's own discovery document reports the matching values:
 *   issuer   https://<project>.supabase.co/auth/v1
 *   jwks_uri https://<project>.supabase.co/auth/v1/.well-known/jwks.json
 */
const supabaseUrl = (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const issuer = supabaseUrl
  ? `${supabaseUrl}/auth/v1`
  : 'https://supabase-url-not-set.invalid/auth/v1';

export default {
  providers: [
    {
      type: 'customJwt',
      issuer,
      jwks: `${issuer}/.well-known/jwks.json`,
      algorithm: 'ES256',
      // Supabase access tokens carry `aud: "authenticated"`. Omitting this is
      // documented as often insecure, so it is set explicitly.
      applicationID: 'authenticated',
    },
  ],
} satisfies AuthConfig;
