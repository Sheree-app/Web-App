"use client";
import { usePathname } from "next/navigation";
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
  if (status === "loading") return <div className="flex min-h-64 items-center justify-center"><Spinner label="Connecting to messages" /></div>;
  if (status === "disabled") return <MessagingState title="Messages are not available yet" detail="Messaging is being set up. Please check back soon." />;
  if (status === "error") return <MessagingState title="Messages could not connect" detail="Try reconnecting, or sign in again to refresh your session." action={retry} />;
  if (status !== "ready") return null;
  return <MessagingBoundary key={pathname}>{children}</MessagingBoundary>;
}
