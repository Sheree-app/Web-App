"use client";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Component, type ReactNode } from "react";
import { Spinner } from "@/components/ui";
import { useMessaging } from "@/providers/messaging-provider";

export class MessagingBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) { console.error("Messaging unavailable", error); }
  render() {
    if (this.state.failed) return this.props.fallback !== undefined ? this.props.fallback : <MessagingState title="Messages could not load" detail="Please try again. If this continues, check back shortly." action={() => this.setState({ failed: false })} />;
    return this.props.children;
  }
}
export function MessagingState({ title, detail, action }: { title: string; detail: string; action?: () => void }) {
  return <div className="rounded-card bg-surface p-8 text-center"><h2 className="text-title text-ink">{title}</h2><p className="mt-2 text-body text-muted">{detail}</p>{action && <button type="button" onClick={action} className="mt-4 rounded-full bg-primary px-5 py-3 text-caption font-bold text-surface">Try again</button>}</div>;
}
export function MessagingGate({ children }: { children: ReactNode }) {
  const { status, retry } = useMessaging();
  const pathname = usePathname();
  if (status === "loading") return <GateFrame><div className="flex min-h-64 items-center justify-center"><Spinner label="Connecting to messages" /></div></GateFrame>;
  if (status === "disabled") return <GateFrame><MessagingState title="Messages are not available yet" detail="Messaging is being set up. Please check back soon." /></GateFrame>;
  if (status === "error") return <GateFrame><MessagingState title="Messages could not connect" detail="Try reconnecting, or sign in again to refresh your session." action={retry} /></GateFrame>;
  if (status !== "ready") return null;
  return <MessagingBoundary key={pathname}>{children}</MessagingBoundary>;
}

/**
 * On a phone, Messages has no page padding and no bottom bar (it owns the
 * screen, as in the app), so these states bring their own spacing and a way back.
 */
function GateFrame({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <div className="max-md:px-4 max-md:pt-[calc(8px+env(safe-area-inset-top))]">
      <button
        type="button"
        aria-label="Go back"
        onClick={() => (window.history.length > 1 ? router.back() : router.push("/home"))}
        className="-ml-2 mb-2 flex size-10 items-center justify-center rounded-full text-ink transition hover:bg-tint md:hidden"
      >
        <ChevronLeft aria-hidden className="size-6" />
      </button>
      {children}
    </div>
  );
}
