import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FoundingBadge } from "./FoundingBadge";
import { ProfessionalName } from "./ProfessionalName";

/**
 * The badge renders from server markup, so these assertions cover what a
 * screen reader and keyboard user actually receive: a real button with the
 * "Founding Beautician" label, a dialog trigger, and the pink artwork.
 */
describe("FoundingBadge", () => {
  it("renders when founding is true", () => {
    const html = renderToStaticMarkup(<FoundingBadge founding />);
    expect(html).toContain('aria-label="Founding Beautician"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    // The pink seal artwork, not a generic glyph.
    expect(html).toContain('src="/images/founding-beautician.png"');
  });

  it("supports the icon-plus-label mode", () => {
    const html = renderToStaticMarkup(<FoundingBadge founding label />);
    expect(html).toContain("Founding Beautician");
    expect(html).toContain('src="/images/founding-beautician.png"');
  });

  it("renders nothing when founding is false", () => {
    expect(renderToStaticMarkup(<FoundingBadge founding={false} />)).toBe("");
  });

  it("renders nothing when founding is unknown and no id is available", () => {
    expect(renderToStaticMarkup(<FoundingBadge />)).toBe("");
    expect(renderToStaticMarkup(<FoundingBadge founding={null} />)).toBe("");
  });

  it("renders a non-interactive mark when nested in a link", () => {
    const html = renderToStaticMarkup(<FoundingBadge founding interactive={false} />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Founding Beautician"');
    expect(html).not.toContain("<button");
  });
});

describe("ProfessionalName status separation", () => {
  it("shows verification without implying founding status", () => {
    const html = renderToStaticMarkup(
      <ProfessionalName name="Adjoa" verified founding={false} official={false} />,
    );
    expect(html).toContain("Adjoa");
    expect(html).toContain("Verified Professional");
    expect(html).not.toContain("Founding Beautician");
  });

  it("shows official status without implying founding status", () => {
    const html = renderToStaticMarkup(
      <ProfessionalName name="Adjoa" verified={false} founding={false} official />,
    );
    expect(html).toContain("Sheree official");
    expect(html).toContain('src="/images/goldbadge.png"');
    expect(html).not.toContain("Founding Beautician");
  });

  it("keeps the product order: name → verified → founding → official", () => {
    const html = renderToStaticMarkup(
      <ProfessionalName name="Adjoa" verified founding official />,
    );
    const nameIndex = html.indexOf("Adjoa");
    const verifiedIndex = html.indexOf("Verified Professional");
    const foundingIndex = html.indexOf("Founding Beautician");
    const officialIndex = html.indexOf("Sheree official");

    expect(nameIndex).toBeGreaterThanOrEqual(0);
    expect(verifiedIndex).toBeGreaterThan(nameIndex);
    expect(foundingIndex).toBeGreaterThan(verifiedIndex);
    expect(officialIndex).toBeGreaterThan(foundingIndex);
  });
});
