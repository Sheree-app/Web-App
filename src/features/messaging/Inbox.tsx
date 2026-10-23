"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { MessageCircle, ArrowUpRight } from "lucide-react";
import { Avatar, Spinner } from "@/components/ui";
import { FoundingBadge } from "@/features/badges/FoundingBadge";
import { api } from "../../../convex/_generated/api";
import { useAuth } from "@/providers/auth-provider";
import { MessagingUnread } from "@/providers/messaging-provider";
import { cn, timeAgo } from "@/lib/utils";

export function Inbox() {
  const { appMode, role } = useAuth();
  const [inbox, setInbox] = useState<"customer" | "professional">(appMode);
  const [limit, setLimit] = useState(40);
  const conversations = useQuery(api.conversations.list, { inbox, limit });
  return <section className="mx-auto max-w-3xl">
    <p className="text-eyebrow uppercase text-primary">Your conversations</p>
    <h1 className="mt-1 text-page text-ink">Messages</h1>
    <p className="mt-2 text-body text-muted">Talk through the details before your next appointment.</p>
    <div className="mt-6 flex gap-2" role="tablist" aria-label="Message inbox">
      {(["customer", ...(role === "professional" ? ["professional"] : [])] as Array<"customer" | "professional">).map(value => <button key={value} type="button" role="tab" aria-selected={inbox === value} onClick={() => { setInbox(value); setLimit(40); }} className={cn("flex items-center gap-2 rounded-full px-5 py-3 text-caption font-bold", inbox === value ? "bg-ink text-surface" : "bg-surface text-muted")}>
        {value === "customer" ? "As a customer" : "As a professional"}
        <MessagingUnread inbox={value}>{count => count > 0 && <span className="rounded-full bg-primary px-2 text-surface">{count > 99 ? "99+" : count}</span>}</MessagingUnread>
      </button>)}
    </div>
    {conversations === undefined ? <div className="flex justify-center p-12"><Spinner label="Loading conversations" /></div> : conversations.length === 0 ? <div className="mt-6 rounded-card bg-surface p-10 text-center"><MessageCircle aria-hidden className="mx-auto size-9 text-primary" /><h2 className="mt-4 text-title text-ink">No conversations yet</h2><p className="mt-2 text-body text-muted">{inbox === "customer" ? "Open a professional's profile to start a conversation." : "Messages from your customers will appear here."}</p>{inbox === "customer" && <Link href="/explore" className="mt-5 inline-flex items-center gap-2 text-caption font-bold text-primary">Find a professional <ArrowUpRight className="size-4" /></Link>}</div> : <>
      <ul className="mt-6 divide-y divide-line overflow-hidden rounded-card bg-surface">{conversations.map(thread => <li key={thread.id}><Link href={`/messages/${thread.id}`} className="flex items-center gap-3 p-4 transition hover:bg-tint focus-visible:bg-tint">
        <Avatar name={thread.peer.displayName} src={thread.peer.avatarUrl} size={48} />
        <div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><span className="flex min-w-0 items-center gap-[3px]"><h2 className={cn("truncate text-body text-ink", thread.unreadCount > 0 && "font-bold")}>{thread.peer.displayName}</h2><FoundingBadge userId={thread.peer.externalId} size={14} interactive={false} /></span><time dateTime={new Date(thread.lastMessageAt).toISOString()} className="shrink-0 text-[11px] text-muted">{timeAgo(new Date(thread.lastMessageAt).toISOString())}</time></div><p className="mt-1 truncate text-caption text-muted">{thread.lastMessageFromMe ? "You: " : ""}{thread.lastMessagePreview || "Start the conversation"}</p></div>
        {thread.unreadCount > 0 && <span aria-label={`${thread.unreadCount} unread messages`} className="min-w-6 rounded-full bg-primary px-1.5 py-1 text-center text-[11px] font-bold text-surface">{thread.unreadCount > 99 ? "99+" : thread.unreadCount}</span>}
      </Link></li>)}</ul>
      {conversations.length >= limit && limit < 100 && <button type="button" onClick={() => setLimit(100)} className="mt-4 text-caption font-bold text-primary">Show more conversations</button>}
    </>}
  </section>;
}
