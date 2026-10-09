                                                                                                import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The pre-web React Native source is kept for parity checks only.
    "mobile/**",
    "supabase/functions/**",
    // Next.js writes route and validator types here at build time.
    "types/**",
  ]),
  {
    // `set-state-in-effect` fires on the "fetch when the key changes" shape used
    // throughout this app: the effect kicks off a request and flips `loading`
    // on. That is the point of a loading flag — one extra render per request,
    // and the alternative (deriving the flag from a stored key on every screen)
    // would spread the same bookkeeping across twenty components.
    //
    // Worth revisiting when these screens move to server rendering or `use()`
    // with Suspense, which is where this rule is pushing.
    rules: {
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // The data layer is the mobile app's code, moved across unchanged: it talks
    // to Supabase RPCs whose row shapes don't exist in the generated types, and
    // it handled that with `any` casts at the call site. Rewriting those to
    // proper generics is worth doing, but it is a data-layer job of its own and
    // not something a UI port should silently change.
    // (the `.ts` glob is the data layer — every `.tsx` in those folders is UI and
    // is held to the normal rules).
    files: ["src/features/**/*.ts", "src/lib/supabase/untyped.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
    },
  },
]);

export default eslintConfig;
