"use client";

import { Button, Sheet, Switch } from "@/components/ui";
import { AppError, userMessage } from "@/lib/errors";
import { useToast } from "@/providers/toast-provider";
import { Download, Send } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SpendMonth } from "./api";
import { spendCategory } from "./categories";
import { monthLabel } from "./format";
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  drawSpendCard,
  loadCardFonts,
  loadIconImages,
  type CardFonts,
  type CardIcons,
} from "./SpendShareCard";

/**
 * Preview, download or share the "my beauty month" card. The preview is the
 * very canvas that gets exported, so what she sees is what she posts. Share
 * uses the Web Share API with the PNG attached where the browser supports
 * files (most phones); elsewhere Download is the one action.
 */
export function SpendShareSheet({
  open,
  data,
  onClose,
}: {
  open: boolean;
  data: SpendMonth;
  onClose: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Share your beauty month">
      {open ? <ShareBody data={data} /> : null}
    </Sheet>
  );
}

const noSubscription = () => () => undefined;
const canShareFiles = () => {
  try {
    const probe = new File([new Uint8Array(1)], "probe.png", { type: "image/png" });
    return typeof navigator.canShare === "function" && navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
};

function ShareBody({ data }: { data: SpendMonth }) {
  const { error: showError, success } = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const iconsRef = useRef<HTMLDivElement>(null);
  const assets = useRef<Promise<{ fonts: CardFonts; icons: CardIcons }> | null>(null);
  const [showAmounts, setShowAmounts] = useState(true);
  const [drawn, setDrawn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<"share" | "save" | null>(null);
  // Browser-only; the server (and the first client render) assume no file sharing.
  const shareFiles = useSyncExternalStore(noSubscription, canShareFiles, () => false);

  useEffect(() => {
    let live = true;
    const root = iconsRef.current;
    if (!root) return;
    assets.current ??= Promise.all([loadCardFonts(), loadIconImages(root)]).then(([fonts, icons]) => ({
      fonts,
      icons,
    }));
    assets.current
      .then(({ fonts, icons }) => {
        if (!live || !canvasRef.current) return;
        drawSpendCard(canvasRef.current, data, { showAmounts, fonts, icons });
        setDrawn(true);
      })
      .catch(() => {
        if (live) setDrawn(false);
      });
    return () => {
      live = false;
    };
  }, [data, showAmounts]);

  const fileName = `sheree-beauty-month-${data.month}.png`;
  const title = `My beauty month · ${monthLabel(data.month)}`;

  const toBlob = () =>
    new Promise<Blob>((resolve, reject) => {
      const canvas = canvasRef.current;
      if (!canvas || !drawn) {
        reject(new AppError("Your card is not ready yet. Please try again."));
        return;
      }
      canvas.toBlob(
        (blob) =>
          blob && blob.size > 0
            ? resolve(blob)
            : reject(new AppError("Your card could not be created. Please try again.")),
        "image/png",
      );
    });

  const save = async () => {
    if (busy) return;
    setBusy("save");
    try {
      const url = URL.createObjectURL(await toBlob());
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      success("Card downloaded", "Your beauty month is ready for the dump.");
    } catch (error) {
      showError("Card not saved", userMessage(error, "We couldn't save your card. Please try again.", "spend.save"));
    } finally {
      setBusy(null);
    }
  };

  const share = async () => {
    if (busy) return;
    setBusy("share");
    try {
      const file = new File([await toBlob()], fileName, { type: "image/png" });
      await navigator.share({ files: [file], title, text: title });
    } catch (error) {
      // Closing the share sheet without picking anything is not an error.
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        showError("Card not shared", userMessage(error, "We couldn't share your card. Please try again.", "spend.share"));
      }
    } finally {
      setBusy(null);
    }
  };

  const top = data.categories.slice(0, 4);
  const leader = data.categories[0] ? spendCategory(data.categories[0].slug, data.categories[0].name) : null;
  const LeaderIcon = leader?.icon ?? spendCategory("other").icon;

  return (
    <div className="flex flex-col">
      <p className="text-eyebrow text-primary uppercase">For the dump</p>

      {/* The card's icons, rendered once so the canvas can draw them. */}
      <div ref={iconsRef} hidden>
        {top.map((c) => {
          const cat = spendCategory(c.slug, c.name);
          const Icon = cat.icon;
          return <Icon key={c.slug} data-icon={c.slug} data-color={cat.color} data-px={16} />;
        })}
        <LeaderIcon data-icon={`${leader?.slug ?? "other"}:leader`} data-color={leader?.color ?? "#C77489"} data-px={20} />
      </div>

      <div
        className="relative mx-auto mt-3 aspect-[9/16] w-[min(100%,260px)] overflow-hidden rounded-[22px] bg-[#FBF1EC] shadow-[0_10px_20px_rgb(22_15_19/0.18)] md:w-[288px]"
        style={{ maxHeight: "52dvh", maxWidth: `calc(52dvh * ${CARD_WIDTH / CARD_HEIGHT})` }}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={`${title} card preview`}
          className="block size-full"
        />
        {drawn === null ? (
          <div className="absolute inset-0 animate-shimmer bg-skeleton motion-reduce:animate-none" aria-hidden />
        ) : null}
        {drawn === false ? (
          <p className="absolute inset-0 flex items-center justify-center p-6 text-center text-caption text-[#2E2326]">
            We couldn’t draw your card. Close this and try again.
          </p>
        ) : null}
      </div>

      <div className="mt-4">
        <Switch
          checked={showAmounts}
          onChange={setShowAmounts}
          label="Show amounts"
          description="Off shows percentages instead of cedis."
        />
      </div>

      <div className="mt-4 flex gap-3">
        <Button
          variant={shareFiles ? "outline" : "primary"}
          className="flex-1 rounded-full font-bold"
          disabled={!drawn || busy !== null}
          loading={busy === "save"}
          onClick={() => void save()}
        >
          {busy === "save" ? null : <Download aria-hidden className="size-[19px]" />}
          Download
        </Button>
        {shareFiles ? (
          <Button
            className="flex-[1.4] rounded-full font-bold"
            disabled={!drawn || busy !== null}
            loading={busy === "share"}
            onClick={() => void share()}
          >
            {busy === "share" ? null : <Send aria-hidden className="size-[19px]" />}
            Share
          </Button>
        ) : null}
      </div>
    </div>
  );
}
