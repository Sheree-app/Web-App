"use client";

import { useQuery } from "convex/react";
import { ArrowUpRight, ImageIcon, MessageCircle, Search, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Avatar, Spinner } from "@/components/ui";
import { FoundingBadge } from "@/features/badges/FoundingBadge";
import { useAuth } from "@/providers/auth-provider";
import { MessagingUnread } from "@/providers/messaging-provider";
import { api } from "../../../convex/_generated/api";
import { cn } from "@/lib/utils";
import { presenceLabel } from "./format";

/**
 * The conversation list.
 *
 * One inbox at a time, chosen by the role the account holds INSIDE each thread
 * (never by the mode switch): the customer tab asks for threads where this
 * account is `customerUserId`, the professional tab for `professionalUserId`.
 *
 * On a phone it is the whole messages screen; from `lg` up it is the left pane
 * of `MessagesShell`, so it drops its card chrome and lets its own rows scroll.
 */
export function Inbox({ activeId = null }: { activeId?: string | null }) {
  const { appMode, role } = useAuth();
  const [inbox, setInbox] = useState<"customer" | "professional">(
    appMode === "professional" ? "professional" : "customer",
  );
  const [limit, setLimit] = useState(40);
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const conversations = useQuery(api.conversations.list, { inbox, limit });
  const tabs: Array<"customer" | "professional"> =
    role === "professional" ? ["customer", "professional"] : ["customer"];

  const filtered = useMemo(() => {
    if (!conversations) return [];
    const needle = query.trim().toLowerCase();
    if (!needle) return conversations;
    return conversations.filter(
      (thread) =>
        thread.peer.displayName.toLowerCase().includes(needle) ||
        thread.peer.username.toLowerCase().includes(needle) ||
        thread.lastMessagePreview.toLowerCase().includes(needle),
    );
  }, [conversations, query]);

  /** Arrow keys move between rows without leaving the list. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const links = Array.from(
      listRef.current?.querySelectorAll<HTMLAnchorElement>("a[data-thread]") ?? [],
    );
    if (links.length === 0) return;
    const current = links.findIndex((link) => link === document.activeElement);
    let next = current;
    if (event.key === "ArrowDown") next = current < 0 ? 0 : (current + 1) % links.length;
    if (event.key === "ArrowUp") next = current <= 0 ? links.length - 1 : current - 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = links.length - 1;
    event.preventDefault();
    links[next]?.focus();
  };

  return (
    <section className="flex h-full min-h-0 w-full flex-col">
      <header className="shrink-0 px-4 pt-2 lg:px-5 lg:pt-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-eyebrow uppercase text-primary">Your conversations</p>
            <h1 className="mt-1 text-page text-ink lg:text-title">Messages</h1>
          </div>
          <MessagingUnread inbox={inbox}>
            {(count) =>
              count > 0 ? (
                <span className="mt-1 rounded-full bg-tint px-2.5 py-1 text-[10px] font-bold text-primary">
                  {count > 99 ? "99+" : count} unread
                </span>
              ) : null
            }
          </MessagingUnread>
        </div>
        <p className="mt-2 max-w-[420px] text-body text-muted lg:mt-1 lg:text-caption">
          Talk through the details before your next appointment.
        </p>

        <div className="relative mt-3">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
          />
          <label className="sr-only" htmlFor="conversation-search">
            Search conversations
          </label>
          <input
            id="conversation-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or message"
            className="min-h-11 w-full rounded-full border border-line bg-background pl-10 pr-10 text-caption text-ink outline-none transition focus:border-primary"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-tint hover:text-ink"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          ) : null}
        </div>
      </header>

      {tabs.length > 1 ? (
        <div
          className="mt-4 flex shrink-0 gap-2 px-4 lg:mt-3 lg:px-5"
          role="tablist"
          aria-label="Message inbox"
        >
          {tabs.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              id={`inbox-tab-${value}`}
              aria-selected={inbox === value}
              aria-controls="inbox-panel"
              onClick={() => {
                setInbox(value);
                setLimit(40);
              }}
              className={cn(
                "flex items-center gap-2 rounded-full px-4 py-2.5 text-caption font-bold transition",
                "lg:px-3.5 lg:py-2 lg:text-[11px]",
                inbox === value
                  ? "bg-ink text-surface"
                  : "bg-surface text-muted hover:bg-tint",
              )}
            >
              {value === "customer" ? "As a customer" : "As a professional"}
              <MessagingUnread inbox={value}>
                {(count) =>
                  count > 0 ? (
                    <span className="rounded-full bg-primary px-2 text-surface">
                      {count > 99 ? "99+" : count}
                    </span>
                  ) : null
                }
              </MessagingUnread>
            </button>
          ))}
        </div>
      ) : null}

      <div
        id="inbox-panel"
        role="tabpanel"
        aria-labelledby={`inbox-tab-${inbox}`}
        className="mt-3 min-h-0 flex-1 lg:overflow-y-auto lg:overscroll-contain lg:pb-2"
      >
        {conversations === undefined ? (
          <div className="flex justify-center p-12">
            <Spinner label="Loading conversations" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="mx-4 mt-2 rounded-card bg-surface p-10 text-center lg:mx-3 lg:mt-0 lg:rounded-none lg:border-t lg:border-line lg:bg-transparent">
            <MessageCircle aria-hidden className="mx-auto size-9 text-primary" />
            <h2 className="mt-4 text-title text-ink">No conversations yet</h2>
            <p className="mt-2 text-body text-muted">
              {inbox === "customer"
                ? "Open a professional's profile to start a conversation."
                : "Messages from your customers will appear here."}
            </p>
            {inbox === "customer" ? (
              <Link
                href="/explore"
                className="mt-5 inline-flex items-center gap-2 text-caption font-bold text-primary"
              >
                Find a professional <ArrowUpRight className="size-4" />
              </Link>
            ) : null}
          </div>
        ) : filtered.length === 0 ? (
          <div className="mx-4 mt-2 rounded-card bg-surface p-8 text-center lg:mx-3 lg:mt-0">
            <Search aria-hidden className="mx-auto size-7 text-muted" />
            <h2 className="mt-3 text-title text-ink">No matches</h2>
            <p className="mt-1 text-caption text-muted">
              Nothing in this inbox matches “{query.trim()}”.
            </p>
            <button
              type="button"
              onClick={() => setQuery("")}
              className="mt-4 text-caption font-bold text-primary"
            >
              Clear search
            </button>
          </div>
        ) : (
          <>
            <ul
              ref={listRef}
              onKeyDown={onKeyDown}
              aria-label={`${inbox === "customer" ? "Customer" : "Professional"} inbox`}
              className="divide-y divide-line overflow-hidden rounded-card bg-surface lg:rounded-none lg:border-t lg:border-line lg:bg-transparent"
            >
              {filtered.map((thread) => {
                const presence = presenceLabel(thread.peerPresence);
                const selected = thread.id === activeId;
                return (
                  <li key={thread.id}>
                    <Link
                      href={`/messages/${thread.id}`}
                      data-thread={thread.id}
                      aria-current={selected ? "page" : undefined}
                      className={cn(
                        "flex min-h-[72px] items-center gap-3 p-4 transition hover:bg-tint",
                        "focus-visible:bg-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset",
                        "lg:gap-2.5 lg:px-3 lg:py-3",
                        selected && "bg-tint",
                      )}
                    >
                      <span className="relative shrink-0" title={presence ?? undefined}>
                        <Avatar
                          name={thread.peer.displayName}
                          src={thread.peer.avatarUrl}
                          size={48}
                        />
                        {thread.peerPresence?.online ? (
                          <span
                            aria-hidden
                            className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-surface bg-success"
                          />
                        ) : null}
                        {presence ? <span className="sr-only">{presence}</span> : null}
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-[3px]">
                            <h2
                              className={cn(
                                "truncate text-body text-ink",
                                thread.unreadCount > 0 && "font-bold",
                              )}
                            >
                              {thread.peer.displayName}
                            </h2>
                            <FoundingBadge
                              userId={thread.peer.externalId}
                              size={14}
                              interactive={false}
                            />
                          </span>
                          <time
                            dateTime={new Date(thread.lastMessageAt).toISOString()}
                            className="shrink-0 text-[11px] text-muted"
                          >
                            {new Date(thread.lastMessageAt).toLocaleDateString([], {
                              day: "numeric",
                              month: "short",
                            })}
                          </time>
                        </div>
                        <p
                          className={cn(
                            "mt-0.5 truncate text-caption",
                            thread.unreadCount > 0 ? "font-medium text-ink" : "text-muted",
                          )}
                        >
                          {thread.lastMessageFromMe ? "You: " : ""}
                          {thread.lastMessagePreview || "Start the conversation"}
                        </p>
                        {thread.lifecycle !== "active" ? (
                          <span className="mt-1 inline-block rounded-full bg-tint px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.8px] text-muted">
                            {thread.lifecycle === "booked"
                              ? "Booking in progress"
                              : thread.lifecycle === "settled"
                                ? "Settled"
                                : "Closed"}
                          </span>
                        ) : null}
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        {thread.originImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={thread.originImageUrl}
                            alt=""
                            loading="lazy"
                            className="size-9 rounded-tile object-cover"
                          />
                        ) : (
                          <span
                            aria-hidden
                            className="flex size-9 items-center justify-center rounded-tile bg-tint text-muted"
                          >
                            <ImageIcon className="size-4" />
                          </span>
                        )}
                        {thread.unreadCount > 0 ? (
                          <span
                            aria-label={`${thread.unreadCount} unread messages`}
                            className="min-w-6 rounded-full bg-primary px-1.5 py-0.5 text-center text-[11px] font-bold text-surface"
                          >
                            {thread.unreadCount > 99 ? "99+" : thread.unreadCount}
                          </span>
                        ) : null}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {conversations.length >= limit && limit < 100 ? (
              <button
                type="button"
                onClick={() => setLimit(100)}
                className="mt-4 px-4 text-caption font-bold text-primary lg:mt-3 lg:px-3"
              >
                Show more conversations
              </button>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
