import { LookbookRail } from "@/components/brand/lookbook-rail";
import { Wordmark } from "@/components/brand/wordmark";
import { ButtonLink } from "@/components/ui";

/**
 * The landing page, rebuilt to match the mobile welcome screen line for line:
 * the same masthead, hairline, four-line display block, lookbook marquee, the
 * two sides of the marketplace, then the two ways in.
 *
 * The original was a single 520px column centred on the screen — that is what
 * it stays here, on every width, because the design is the point.
 */
export default function WelcomePage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background px-6 pt-safe pb-safe">
      <div className="mx-auto flex w-full max-w-[520px] flex-1 flex-col justify-between gap-4 py-4">
        <div className="flex flex-col gap-4">
          <header className="flex items-center justify-between">
            <Wordmark size="md" className="text-[34px] leading-[44px] text-ink" />
            <p className="text-eyebrow text-muted uppercase">Ghana</p>
          </header>

          <div className="h-px bg-line" />

          <h1
            aria-label="Run your beauty business. Find your look, and who makes it."
            className="text-hero text-ink"
          >
            <span className="block">Let Sheree</span>
            <span className="block">work for you.</span>
            <span className="block">Find your inspo —</span>
            <span className="block">and who makes it.</span>
          </h1>
        </div>

        <section className="flex flex-col gap-3">
          <p className="text-eyebrow text-muted uppercase">The lookbook</p>
          <LookbookRail />
          <p className="text-caption text-muted">Save real work to your lookbook.</p>
        </section>

        <section className="flex flex-col gap-4">
          <p className="text-eyebrow text-muted uppercase">Both sides live here</p>
          <div className="flex gap-4">
            <div className="flex-1">
              <p className="text-eyebrow text-primary uppercase">I’m looking for</p>
              <p className="mt-1 text-caption text-ink">
                Inspos, and the people who can create them in real life.
              </p>
            </div>
            <div className="flex-1 text-right">
              <p className="text-eyebrow text-primary uppercase">I create</p>
              <p className="mt-1 text-caption text-ink">
                Your inspos in real life, for people looking for beauty.
              </p>
            </div>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <div className="h-px bg-line" />
          <div className="flex flex-col gap-3">
            <ButtonLink href="/sign-up">Join Sheree</ButtonLink>
            <ButtonLink href="/discover" variant="secondary">
              Explore Sheree
            </ButtonLink>
          </div>
        </section>
      </div>
    </div>
  );
}
