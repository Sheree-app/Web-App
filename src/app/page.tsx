import { LookbookRail } from "@/components/brand/lookbook-rail";
import { Wordmark } from "@/components/brand/wordmark";
import { ButtonLink } from "@/components/ui";

/** Responsive welcome screen with a two-column desktop layout. */
export default function WelcomePage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background px-6 pt-safe pb-safe">
      <div className="mx-auto flex w-full max-w-[520px] flex-1 flex-col justify-between gap-4 py-4 md:max-w-7xl md:py-8 lg:grid lg:grid-cols-2 lg:content-center lg:gap-x-16 lg:gap-y-10">
        <div className="flex flex-col gap-4 lg:row-span-2 lg:gap-8">
          <header className="flex items-center justify-between">
            <Wordmark size="md" className="text-[34px] leading-[44px] text-ink" />
            <p className="text-eyebrow text-muted uppercase">Ghana</p>
          </header>

          <div className="h-px bg-line" />

          <h1
            aria-label="Run your beauty business. Find your look, and who makes it."
            className="text-hero text-ink lg:text-[52px] lg:leading-[1.15] xl:text-[60px]"
          >
            <span className="block">Let Sheree</span>
            <span className="block">work for you.</span>
            <span className="block">Find your inspo —</span>
            <span className="block">and who makes it.</span>
          </h1>
        </div>

        <section className="flex min-w-0 flex-col gap-3 lg:overflow-hidden lg:rounded-card lg:bg-tint lg:p-8">
          <p className="text-eyebrow text-muted uppercase">The lookbook</p>
          <LookbookRail />
          <p className="text-caption text-muted">Save real work to your lookbook.</p>
        </section>

        <section className="flex flex-col gap-4 lg:col-start-2">
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

        <section className="flex flex-col gap-4 lg:col-span-2">
          <div className="h-px bg-line" />
          <div className="flex flex-col gap-3 md:flex-row md:[&>*]:flex-1 lg:max-w-xl">
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
