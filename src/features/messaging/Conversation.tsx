"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { ArrowLeft, Check, CheckCheck, Send } from "lucide-react";
import { Avatar, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { MessagingState } from "./MessagingGate";

export function Conversation({ conversationId }: { conversationId: string }) {
  const id = conversationId as Id<"conversations">;
  const conversation = useQuery(api.conversations.get, { conversationId: id });
  if (conversation === undefined) return <div className="flex justify-center p-12"><Spinner label="Loading conversation" /></div>;
  if (!conversation) return <MessagingState title="Conversation unavailable" detail="This conversation may no longer exist, or you may not have access to it." />;
  return <section className="mx-auto max-w-3xl overflow-hidden rounded-card border border-line bg-surface">
    <header className="flex items-center gap-3 border-b border-line p-4"><Link href="/messages" aria-label="Back to messages" className="rounded-full p-2 hover:bg-tint"><ArrowLeft className="size-5" /></Link><Avatar name={conversation.peer.displayName} src={conversation.peer.avatarUrl} size={40} /><div className="min-w-0"><h1 className="truncate text-title text-ink">{conversation.peer.displayName}</h1><p className="text-caption text-muted">{conversation.viewerRole === "customer" ? "Your professional" : "Your customer"}</p></div></header>
    <MessageHistory conversationId={id} />
  </section>;
}

function MessageHistory({ conversationId }: { conversationId: Id<"conversations"> }) {
  const { results, status, loadMore } = usePaginatedQuery(api.messages.list, { conversationId }, { initialNumItems: 30 });
  const receipt = useQuery(api.conversations.readReceipt, { conversationId });
  const sendText = useMutation(api.messages.sendText);
  const markRead = useMutation(api.conversations.markRead);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [readError, setReadError] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const historyAnchor = useRef<{ height: number; top: number } | null>(null);
  const marked = useRef<string | null>(null);
  const pending = useRef<{ body: string; clientMessageId: string } | null>(null);
  const latest = results[0];
  const messages = [...results].reverse();

  useEffect(() => {
    const el = scroll.current;
    if (el && status !== "LoadingMore" && historyAnchor.current) {
      el.scrollTop = historyAnchor.current.top + el.scrollHeight - historyAnchor.current.height;
      historyAnchor.current = null;
    }
  }, [results.length, status]);

  useEffect(() => {
    if (nearBottom.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [latest?.id]);

  useEffect(() => {
    const root = scroll.current;
    const target = end.current;
    if (!latest || !root || !target) return;
    let visible = false;
    let active = true;
    const acknowledge = () => {
      if (!visible || document.visibilityState !== "visible" || !document.hasFocus() || marked.current === latest.id) return;
      marked.current = latest.id;
      void markRead({ conversationId, lastReadMessageId: latest.id }).then(() => { if (active) setReadError(false); }).catch(() => { marked.current = null; if (active) setReadError(true); });
    };
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; acknowledge(); }, { root, threshold: 1 });
    observer.observe(target);
    document.addEventListener("visibilitychange", acknowledge);
    window.addEventListener("focus", acknowledge);
    const retry = window.setInterval(acknowledge, 10_000);
    return () => { active = false; observer.disconnect(); clearInterval(retry); document.removeEventListener("visibilitychange", acknowledge); window.removeEventListener("focus", acknowledge); };
  }, [conversationId, latest?.id, latest, markRead]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending || body.length > 4000) return;
    const attempt = pending.current?.body === body ? pending.current : { body, clientMessageId: crypto.randomUUID() };
    pending.current = attempt;
    setSending(true); setError("");
    nearBottom.current = true;
    try {
      await sendText({ conversationId, ...attempt });
      pending.current = null;
      setDraft("");
      scroll.current?.scrollTo({ top: scroll.current.scrollHeight });
    } catch { setError("Your message could not be sent. Check your connection and try again."); }
    finally { setSending(false); }
  };
  return <>
    <div ref={scroll} onScroll={() => { const el = scroll.current; if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }} className="h-[55dvh] min-h-64 overflow-y-auto overscroll-contain bg-background/40 px-4 py-5 md:h-[58dvh]" aria-label="Conversation messages" tabIndex={0}>
      {status === "LoadingFirstPage" ? <div className="flex justify-center p-8"><Spinner label="Loading messages" /></div> : <>
        {status === "CanLoadMore" && <button type="button" className="mx-auto mb-5 block rounded-full bg-secondary px-4 py-2 text-caption font-bold text-ink" onClick={() => {
          const el = scroll.current;
          if (el) historyAnchor.current = { height: el.scrollHeight, top: el.scrollTop };
          nearBottom.current = false;
          loadMore(30);
        }}>Load earlier messages</button>}
        {status === "LoadingMore" && <p className="mb-4 text-center text-caption text-muted">Loading earlier messages...</p>}
        {messages.length === 0 && <p className="py-16 text-center text-body text-muted">Say hello and talk through the details.</p>}
        <ol className="flex flex-col gap-3" aria-label="Messages">{messages.map((message, index) => {
          const cursorIndex = messages.findIndex(item => item.id === receipt?.peerLastReadMessageId);
          const read = message.isMine && (cursorIndex >= 0 ? index <= cursorIndex : receipt?.peerLastReadAt != null && message.createdAt < receipt.peerLastReadAt);
          return <li key={message.id} className={cn("flex", message.isMine ? "justify-end" : "justify-start")}>
            <div className={cn("max-w-[85%] rounded-2xl px-4 py-3 md:max-w-[75%]", message.isMine ? "rounded-br-sm bg-primary text-surface" : "rounded-bl-sm border border-line bg-surface text-ink")}>
              {message.replyTo && <p className="mb-2 border-l-2 border-current/30 pl-2 text-[11px] opacity-75">{message.replyTo.authorName}: {message.replyTo.preview}</p>}
              <p className="whitespace-pre-wrap break-words text-body [overflow-wrap:anywhere]">{message.kind === "text" || message.kind === "system" ? message.body || "Message removed" : message.kind === "image" ? "Photo shared in the mobile app" : message.kind === "voice" ? "Voice note shared in the mobile app" : "Custom quote shared in the mobile app"}</p>
              <div className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-75"><time dateTime={new Date(message.createdAt).toISOString()} title={new Date(message.createdAt).toLocaleString()}>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>{message.isMine && <><span>{read ? "Read" : "Sent"}</span>{read ? <CheckCheck aria-hidden className="size-3.5" /> : <Check aria-hidden className="size-3.5" />}</>}</div>
            </div>
          </li>;
        })}</ol>
      </>}
      <div ref={end} className="h-1" aria-hidden />
    </div>
    <form onSubmit={submit} className="border-t border-line bg-surface p-3">
      {readError && <p role="status" className="mb-2 text-caption text-muted">Read status could not update. Retrying automatically.</p>}
      {error && <p role="alert" className="mb-2 text-caption text-error">{error}</p>}
      <div className="flex items-end gap-2"><label className="min-w-0 flex-1"><span className="sr-only">Message</span><textarea value={draft} onChange={event => setDraft(event.target.value)} disabled={sending} maxLength={4000} rows={2} placeholder="Write a message..." className="w-full resize-none rounded-panel border border-line bg-background px-4 py-3 text-body text-ink outline-none focus:border-primary disabled:opacity-60" /></label><button type="submit" disabled={sending || !draft.trim() || status === "LoadingFirstPage"} aria-label={sending ? "Sending message" : error ? "Retry sending message" : "Send message"} className="mb-1 flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-surface disabled:opacity-40">{sending ? <Spinner label="Sending" /> : <Send aria-hidden className="size-5" />}</button></div>
      <p className="mt-1 text-right text-[10px] text-muted">{draft.length}/4000</p>
    </form>
  </>;
}
