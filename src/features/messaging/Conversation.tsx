"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import {
  ArrowDown,
  ArrowLeft,
  Check,
  CheckCheck,
  CornerUpLeft,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Avatar } from "@/components/ui";
import { FoundingBadge } from "@/features/badges/FoundingBadge";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  buildMessageRows,
  formatTime,
  presenceLabel,
} from "./format";
import { ImageLightbox } from "./ImageLightbox";
import { MessageComposer } from "./MessageComposer";
import { MessagingState } from "./MessagingGate";
import {
  createPending,
  markAcknowledged,
  markFailed,
  reconcilePending,
  retryingPending,
} from "./outbox";
import { PriceCardBubble } from "./PriceCardBubble";
import { PriceCardDialog } from "./PriceCardDialog";
import type {
  ConversationSummary,
  MessageView,
  PendingMessage,
  ReplyReference,
} from "./types";
import { VoicePlayer } from "./VoicePlayer";

const DRAFT_PREFIX = "sheree:messaging:draft:";

function readDraft(conversationId: string): string {
  try {
    return window.localStorage.getItem(`${DRAFT_PREFIX}${conversationId}`) ?? "";
  } catch {
    return "";
  }
}

function writeDraft(conversationId: string, value: string) {
  try {
    const key = `${DRAFT_PREFIX}${conversationId}`;
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    /* private mode, quota — drafts are a convenience */
  }
}

/**
 * The open thread.
 *
 * Fills the right-hand pane on desktop and the whole screen on a phone. The
 * thread, composer and header are one bounded column so the composer can stay
 * put while only the history scrolls — including when a mobile keyboard opens.
 */
export function Conversation({ conversationId }: { conversationId: string }) {
  const id = conversationId as Id<"conversations">;
  const conversation = useQuery(api.conversations.get, { conversationId: id });
  const [priceCardOpen, setPriceCardOpen] = useState(false);

  if (conversation === undefined) {
    return (
      <div className="flex h-full items-center justify-center p-12">
        <Loader2 aria-hidden className="size-6 animate-spin text-primary" />
        <span className="sr-only">Loading conversation</span>
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="p-4 lg:p-6">
        <MessagingState
          title="Conversation unavailable"
          detail="This conversation may no longer exist, or you may not have access to it."
        />
        <div className="mt-4 text-center">
          <Link href="/messages" className="text-caption font-bold text-primary">
            Back to messages
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <section className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col overflow-hidden bg-surface lg:mx-0 lg:max-w-none">
        <ThreadHeader conversation={conversation} />
        <MessageHistory
          conversationId={id}
          conversation={conversation}
          onOpenPriceCard={() => setPriceCardOpen(true)}
        />
      </section>
      {conversation.viewerRole === "professional" ? (
        <PriceCardDialog
          open={priceCardOpen}
          conversationId={id}
          onClose={() => setPriceCardOpen(false)}
        />
      ) : null}
    </>
  );
}

function ThreadHeader({ conversation }: { conversation: ConversationSummary }) {
  const presence = presenceLabel(conversation.peerPresence);
  const roleLabel =
    conversation.viewerRole === "customer" ? "Your professional" : "Your customer";
  const lifecycle =
    conversation.lifecycle === "booked"
      ? "Booked"
      : conversation.lifecycle === "settled"
        ? "Settled"
        : null;

  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-line bg-surface px-3 py-2.5 md:px-4">
      <Link
        href="/messages"
        aria-label="Back to messages"
        className="flex size-10 shrink-0 items-center justify-center rounded-full text-ink transition hover:bg-tint md:hidden"
      >
        <ArrowLeft aria-hidden className="size-5" />
      </Link>
      <span className="relative shrink-0">
        <Avatar
          name={conversation.peer.displayName}
          src={conversation.peer.avatarUrl}
          size={42}
        />
        {conversation.peerPresence?.online ? (
          <span
            aria-hidden
            className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-surface bg-success"
          />
        ) : null}
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="flex items-center gap-[3px] truncate text-title text-ink">
          <span className="truncate">{conversation.peer.displayName}</span>
          <FoundingBadge userId={conversation.peer.externalId} size={16} interactive={false} />
        </h1>
        <p className="flex items-center gap-2 text-caption text-muted">
          <span aria-live="polite">
            {presence ?? roleLabel}
          </span>
          {lifecycle ? (
            <span className="rounded-full bg-tint px-2 py-0.5 text-[10px] font-bold text-muted">
              {lifecycle}
            </span>
          ) : null}
        </p>
      </div>
    </header>
  );
}

function MessageHistory({
  conversationId,
  conversation,
  onOpenPriceCard,
}: {
  conversationId: Id<"conversations">;
  conversation: ConversationSummary;
  onOpenPriceCard: () => void;
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.messages.list,
    { conversationId },
    { initialNumItems: 30 },
  );
  const receipt = useQuery(api.conversations.readReceipt, { conversationId });
  const sendTextMutation = useMutation(api.messages.sendText);
  const sendImageMutation = useMutation(api.messages.sendImage);
  const sendVoiceMutation = useMutation(api.messages.sendVoice);
  const markRead = useMutation(api.conversations.markRead);

  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<ReplyReference | null>(null);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [readError, setReadError] = useState(false);
  const [online, setOnline] = useState(true);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [newCount, setNewCount] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [jumpTarget, setJumpTarget] = useState<Id<"messages"> | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [jumpNotice, setJumpNotice] = useState("");
  const [announcement, setAnnouncement] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const initialScrolled = useRef(false);
  const historyAnchor = useRef<{ height: number; top: number } | null>(null);
  const marked = useRef<string | null>(null);
  const messageRefs = useRef(new Map<string, HTMLLIElement>());
  const latestId = useRef<string | null>(null);

  const messages = useMemo(() => [...results].reverse(), [results]);
  const latest = results[0];

  // Drafts survive refresh without ever leaving the browser.
  useEffect(() => {
    setDraft(readDraft(conversationId));
  }, [conversationId]);

  useEffect(() => {
    const timer = window.setTimeout(() => writeDraft(conversationId, draft), 250);
    return () => window.clearTimeout(timer);
  }, [conversationId, draft]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  /** Drops optimistic bubbles once the server copy is in the query. */
  useEffect(() => {
    setPending((current) =>
      reconcilePending(
        current,
        results.map((message) => message.id),
      ),
    );
  }, [results]);

  // First paint lands at the newest message, never the top of the history.
  useEffect(() => {
    if (status === "LoadingFirstPage" || initialScrolled.current) return;
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    initialScrolled.current = true;
  }, [status, results.length]);

  // Restore the reading position when an older page is prepended.
  useEffect(() => {
    const node = scrollRef.current;
    if (node && status !== "LoadingMore" && historyAnchor.current) {
      node.scrollTop = historyAnchor.current.top + node.scrollHeight - historyAnchor.current.height;
      historyAnchor.current = null;
    }
  }, [results.length, status]);

  // New arrivals: follow them only when the reader is already at the bottom.
  useEffect(() => {
    const id = latest?.id ?? null;
    if (!id || id === latestId.current) return;
    const previous = latestId.current;
    latestId.current = id;
    if (!previous) return;
    const node = scrollRef.current;
    if (!node) return;

    if (nearBottom.current) {
      node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
      setNewCount(0);
    } else if (latest && !latest.isMine) {
      setNewCount((count) => count + 1);
    }
    if (latest && !latest.isMine) {
      setAnnouncement(`New message from ${conversation.peer.displayName}`);
    }
  }, [conversation.peer.displayName, latest]);

  /**
   * Advance the read cursor only while this thread is genuinely in front of
   * the reader: mounted, visible, focused, and scrolled to the newest message.
   */
  useEffect(() => {
    const root = scrollRef.current;
    const target = endRef.current;
    if (!latest || !root || !target) return;
    let visible = false;
    let active = true;

    const acknowledge = () => {
      if (
        !visible ||
        !nearBottom.current ||
        document.visibilityState !== "visible" ||
        !document.hasFocus() ||
        marked.current === latest.id
      ) {
        return;
      }
      marked.current = latest.id;
      void markRead({ conversationId, lastReadMessageId: latest.id })
        .then(() => {
          if (active) setReadError(false);
        })
        .catch(() => {
          marked.current = null;
          if (active) setReadError(true);
        });
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        acknowledge();
      },
      { root, threshold: 0.9 },
    );
    observer.observe(target);
    document.addEventListener("visibilitychange", acknowledge);
    window.addEventListener("focus", acknowledge);
    const retry = window.setInterval(acknowledge, 10_000);
    return () => {
      active = false;
      observer.disconnect();
      window.clearInterval(retry);
      document.removeEventListener("visibilitychange", acknowledge);
      window.removeEventListener("focus", acknowledge);
    };
  }, [conversationId, latest, markRead]);

  /** Finds a replied-to message, loading older pages until it appears. */
  useEffect(() => {
    if (!jumpTarget) return;
    if (results.some((message) => message.id === jumpTarget)) {
      const node = messageRefs.current.get(jumpTarget);
      node?.scrollIntoView({ block: "center", behavior: "smooth" });
      setHighlightId(jumpTarget);
      setJumpTarget(null);
      window.setTimeout(() => setHighlightId(null), 1_800);
      return;
    }
    if (status === "CanLoadMore") {
      const node = scrollRef.current;
      if (node) historyAnchor.current = { height: node.scrollHeight, top: node.scrollTop };
      nearBottom.current = false;
      loadMore(30);
      return;
    }
    if (status === "Exhausted") {
      setJumpTarget(null);
      setJumpNotice("That message is no longer in this conversation.");
    }
  }, [jumpTarget, loadMore, results, status]);

  const onScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
    nearBottom.current = distance < 100;
    setAtBottom(distance < 100);
    if (distance < 100) setNewCount(0);
    if (node.scrollTop < 60 && status === "CanLoadMore" && !historyAnchor.current) {
      historyAnchor.current = { height: node.scrollHeight, top: node.scrollTop };
      nearBottom.current = false;
      loadMore(30);
    }
  };

  const scrollToLatest = useCallback(() => {
    const node = scrollRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    setNewCount(0);
    setAtBottom(true);
    nearBottom.current = true;
  }, []);

  const sendText = async (body: string, replyToMessageId?: Id<"messages">) => {
    const clientMessageId = crypto.randomUUID();
    // The optimistic quote mirrors exactly the message the composer is holding.
    const reference =
      replyToMessageId && replyTo?.messageId === replyToMessageId ? replyTo : null;
    setPending((current) => [
      ...current,
      createPending({ clientMessageId, body, replyTo: reference }),
    ]);
    try {
      const result = await sendTextMutation({
        conversationId,
        body,
        clientMessageId,
        replyToMessageId,
      });
      setPending((current) =>
        markAcknowledged(current, clientMessageId, result.messageId as string),
      );
      // A safety net for a subscription that is slow to deliver the new row.
      window.setTimeout(() => {
        setPending((current) =>
          current.filter((item) => item.clientMessageId !== clientMessageId),
        );
      }, 8_000);
      return true;
    } catch {
      setPending((current) => markFailed(current, clientMessageId));
      return false;
    }
  };

  const retryPending = async (item: PendingMessage) => {
    // Same clientMessageId on purpose: the server collapses this into the
    // original message if the first attempt actually landed.
    setPending((current) => retryingPending(current, item.clientMessageId));
    try {
      const result = await sendTextMutation({
        conversationId,
        body: item.body,
        clientMessageId: item.clientMessageId,
        replyToMessageId: item.replyTo?.messageId,
      });
      setPending((current) =>
        markAcknowledged(current, item.clientMessageId, result.messageId as string),
      );
    } catch {
      setPending((current) => markFailed(current, item.clientMessageId));
    }
  };

  const dismissPending = (clientMessageId: string) => {
    setPending((current) =>
      current.filter((item) => item.clientMessageId !== clientMessageId),
    );
  };

  const sendImage = async (input: {
    storageId: Id<"_storage">;
    width: number;
    height: number;
    mimeType: string;
    sizeBytes: number;
    caption: string;
    replyToMessageId?: Id<"messages">;
  }) => {
    await sendImageMutation({
      conversationId,
      ...input,
      caption: input.caption || undefined,
      clientMessageId: crypto.randomUUID(),
    });
  };

  const sendVoice = async (input: {
    storageId: Id<"_storage">;
    durationMillis: number;
    mimeType: string;
    sizeBytes: number;
    replyToMessageId?: Id<"messages">;
  }) => {
    await sendVoiceMutation({
      conversationId,
      ...input,
      clientMessageId: crypto.randomUUID(),
    });
  };

  const rows = buildMessageRows(messages);
  const peerCursorIndex = messages.findIndex(
    (message) => message.id === receipt?.peerLastReadMessageId,
  );

  const jumpToMessage = (messageId: Id<"messages">) => {
    setJumpNotice("");
    setJumpTarget(messageId);
  };

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      {!online ? (
        <div className="shrink-0 bg-warning/15 px-4 py-2 text-center text-[11px] font-medium text-ink">
          You’re offline. Messages you send will be retried when you reconnect.
        </div>
      ) : null}
      {jumpNotice ? (
        <div className="flex shrink-0 items-center gap-2 bg-tint px-4 py-2 text-[11px] text-muted">
          <span className="flex-1">{jumpNotice}</span>
          <button
            type="button"
            onClick={() => setJumpNotice("")}
            aria-label="Dismiss"
            className="text-muted hover:text-ink"
          >
            <X aria-hidden className="size-3.5" />
          </button>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-background/50 px-3 py-4 md:px-5"
        aria-label="Conversation messages"
        tabIndex={0}
      >
        {status === "LoadingFirstPage" ? (
          <div className="flex justify-center p-10">
            <Loader2 aria-hidden className="size-6 animate-spin text-primary" />
            <span className="sr-only">Loading messages</span>
          </div>
        ) : (
          <>
            {status === "CanLoadMore" ? (
              <button
                type="button"
                onClick={() => {
                  const node = scrollRef.current;
                  if (node) historyAnchor.current = { height: node.scrollHeight, top: node.scrollTop };
                  nearBottom.current = false;
                  loadMore(30);
                }}
                className="mx-auto mb-4 block rounded-full bg-secondary px-4 py-2 text-caption font-bold text-ink transition hover:brightness-[1.02]"
              >
                Load earlier messages
              </button>
            ) : null}
            {status === "LoadingMore" ? (
              <p className="mb-4 flex items-center justify-center gap-2 text-caption text-muted">
                <Loader2 aria-hidden className="size-3.5 animate-spin" />
                Loading earlier messages…
              </p>
            ) : null}

            {messages.length === 0 && pending.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
                <span className="flex size-16 items-center justify-center rounded-full bg-tint">
                  <MessageCircle aria-hidden className="size-7 text-primary" />
                </span>
                <p className="mt-4 text-title text-ink">A fresh conversation</p>
                <p className="mt-1 max-w-[280px] text-caption text-muted">
                  Say hello, share an idea, or ask what’s possible before your next appointment.
                </p>
              </div>
            ) : null}

            <ol className="flex flex-col" aria-label="Messages">
              {rows.map(({ message, groupedWithPrevious, showDay, dayLabel }) => {
                const index = messages.findIndex((item) => item.id === message.id);
                const read = message.isMine
                  ? peerCursorIndex >= 0
                    ? index <= peerCursorIndex
                    : receipt?.peerLastReadAt != null && message.createdAt < receipt.peerLastReadAt
                  : false;
                return (
                  <Fragment key={message.id}>
                    {showDay ? (
                      <li role="presentation" className="list-none">
                        <div role="separator" className="my-5 flex items-center gap-3">
                          <span className="h-px flex-1 bg-line" />
                          <span className="text-[10px] font-bold uppercase tracking-[1.2px] text-muted">
                            {dayLabel}
                          </span>
                          <span className="h-px flex-1 bg-line" />
                        </div>
                      </li>
                    ) : null}
                    <MessageBubble
                      message={message}
                      mine={message.isMine}
                      grouped={groupedWithPrevious}
                      read={read}
                      highlighted={highlightId === message.id}
                      peerExternalId={conversation.peer.externalId}
                      onReply={setReplyTo}
                      onJump={jumpToMessage}
                      onOpenImage={setLightbox}
                      onRemove={(error) =>
                        setJumpNotice(error || "That message could not be removed.")
                      }
                      registerRef={(node) => {
                        if (node) messageRefs.current.set(message.id, node);
                        else messageRefs.current.delete(message.id);
                      }}
                    />
                  </Fragment>
                );
              })}

              {pending.map((item) => (
                <li key={item.clientMessageId} aria-live="polite">
                  {item.replyTo ? (
                    <div className="mb-1 flex justify-end">
                      <p className="max-w-[75%] truncate rounded-field bg-tint px-3 py-1.5 text-[11px] text-muted">
                        {item.replyTo.authorName}: {item.replyTo.preview}
                      </p>
                    </div>
                  ) : null}
                  <div className="flex justify-end">
                    <div
                      className={cn(
                        "max-w-[85%] rounded-2xl rounded-br-sm px-4 py-2.5 md:max-w-[75%]",
                        item.status === "failed"
                          ? "border border-danger/40 bg-danger-surface text-ink"
                          : "bg-primary/90 text-surface",
                      )}
                    >
                      <p className="whitespace-pre-wrap break-words text-body [overflow-wrap:anywhere]">
                        {item.body}
                      </p>
                      <div className="mt-1 flex items-center justify-end gap-2 text-[10px]">
                        <span className="opacity-75">{formatTime(item.createdAt)}</span>
                        {item.status === "sending" ? (
                          <span className="flex items-center gap-1 opacity-80">
                            <Loader2 aria-hidden className="size-3 animate-spin" />
                            Sending
                          </span>
                        ) : (
                          <>
                            <span className="text-danger">Not sent</span>
                            <button
                              type="button"
                              onClick={() => void retryPending(item)}
                              className="flex items-center gap-1 rounded-full bg-surface px-2 py-0.5 font-bold text-ink"
                            >
                              <RotateCcw aria-hidden className="size-3" />
                              Retry
                            </button>
                            <button
                              type="button"
                              onClick={() => dismissPending(item.clientMessageId)}
                              aria-label="Discard unsent message"
                              className="rounded-full p-0.5 text-muted hover:text-ink"
                            >
                              <X aria-hidden className="size-3" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </>
        )}
        <div ref={endRef} className="h-1" aria-hidden />
      </div>

      <div className="relative shrink-0">
        {newCount > 0 ? (
          <button
            type="button"
            onClick={scrollToLatest}
            className="absolute -top-12 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-caption font-bold text-surface shadow-lift"
          >
            <ArrowDown aria-hidden className="size-4" />
            {newCount === 1 ? "1 new message" : `${newCount} new messages`}
          </button>
        ) : !atBottom ? (
          <button
            type="button"
            onClick={scrollToLatest}
            aria-label="Jump to the latest message"
            className="absolute -top-12 right-4 z-10 flex size-10 items-center justify-center rounded-full border border-line bg-surface text-ink shadow-card"
          >
            <ArrowDown aria-hidden className="size-4" />
          </button>
        ) : null}

        <MessageComposer
          conversationId={conversationId}
          draft={draft}
          onDraftChange={setDraft}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSendText={sendText}
          onSendImage={sendImage}
          onSendVoice={sendVoice}
          canCreatePriceCard={conversation.viewerRole === "professional"}
          onOpenPriceCard={onOpenPriceCard}
          online={online}
        />
        {readError ? (
          <p role="status" className="px-4 pb-1 text-center text-[10px] text-muted">
            Read status could not update. Retrying automatically.
          </p>
        ) : null}
      </div>

      <ImageLightbox
        open={Boolean(lightbox)}
        src={lightbox?.src ?? null}
        alt={lightbox?.alt ?? ""}
        onClose={() => setLightbox(null)}
      />
    </>
  );
}

function MessageBubble({
  message,
  mine,
  grouped,
  read,
  highlighted,
  peerExternalId,
  onReply,
  onJump,
  onOpenImage,
  onRemove,
  registerRef,
}: {
  message: MessageView;
  mine: boolean;
  grouped: boolean;
  read: boolean;
  highlighted: boolean;
  peerExternalId: string;
  onReply: (reference: ReplyReference) => void;
  onJump: (messageId: Id<"messages">) => void;
  onOpenImage: (value: { src: string; alt: string }) => void;
  onRemove: (error?: string) => void;
  registerRef: (node: HTMLLIElement | null) => void;
}) {
  const remove = useMutation(api.messages.remove);
  const [menuOpen, setMenuOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const pressRef = useRef<number | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const onContextMenu = (event: ReactMouseEvent) => {
    event.preventDefault();
    setMenuOpen(true);
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.pointerType !== "touch") return;
    pressRef.current = window.setTimeout(() => setMenuOpen(true), 480);
  };
  const clearPress = () => {
    if (pressRef.current !== null) {
      window.clearTimeout(pressRef.current);
      pressRef.current = null;
    }
  };

  const reference: ReplyReference = {
    messageId: message.id,
    authorName: message.authorName,
    preview: message.body.trim() || (message.kind === "image" ? "Photo" : message.kind === "voice" ? "Voice note" : "Message"),
    available: true,
  };

  const removeMessage = async () => {
    if (removing) return;
    setRemoving(true);
    setRemoveError("");
    try {
      await remove({ messageId: message.id });
      setMenuOpen(false);
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "That message could not be removed.";
      setRemoveError(text);
      onRemove(text);
    } finally {
      setRemoving(false);
    }
  };

  if (message.kind === "system") {
    return (
      <li ref={registerRef} className="my-3 flex justify-center">
        <p className="max-w-[80%] rounded-full bg-tint px-4 py-1.5 text-center text-[11px] text-muted">
          {message.body || "Conversation updated"}
        </p>
      </li>
    );
  }

  const hasBody = message.body.trim().length > 0;

  return (
    <li
      ref={registerRef}
      id={`message-${message.id}`}
      className={cn(
        "group/message relative flex scroll-mt-4",
        mine ? "justify-end" : "justify-start",
        grouped ? "mt-0.5" : "mt-3",
        highlighted && "rounded-panel bg-secondary/40 ring-2 ring-primary/40",
      )}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onPointerUp={clearPress}
      onPointerLeave={clearPress}
      onPointerCancel={clearPress}
    >
      <div className="relative flex max-w-[88%] flex-col md:max-w-[76%]">
        <div
          className={cn(
            "relative rounded-2xl px-3.5 py-2",
            mine
              ? "rounded-br-sm bg-primary text-surface"
              : "rounded-bl-sm border border-line bg-surface text-ink",
            grouped && (mine ? "rounded-tr-md" : "rounded-tl-md"),
          )}
        >
          {message.replyTo ? (
            <button
              type="button"
              onClick={() => onJump(message.replyTo!.messageId)}
              disabled={!message.replyTo.available}
              className={cn(
                "mb-2 block w-full rounded-lg border-l-2 px-2 py-1 text-left text-[11px] transition",
                mine ? "border-surface/50 bg-surface/10" : "border-primary/60 bg-tint",
                message.replyTo.available ? "hover:brightness-95" : "opacity-70",
              )}
            >
              <span className="block font-bold opacity-90">{message.replyTo.authorName}</span>
              <span className="block truncate opacity-75">
                {message.replyTo.available ? message.replyTo.preview : "This message was removed"}
              </span>
            </button>
          ) : null}

          {message.image ? (
            message.image.url ? (
              <button
                type="button"
                onClick={() =>
                  onOpenImage({
                    src: message.image!.url!,
                    alt: message.body || `Photo from ${message.authorName}`,
                  })
                }
                className="mb-1.5 block w-full overflow-hidden rounded-xl"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={message.image.url}
                  alt={message.body || `Photo from ${message.authorName}`}
                  loading="lazy"
                  width={message.image.width || undefined}
                  height={message.image.height || undefined}
                  className="max-h-72 w-full object-cover"
                />
              </button>
            ) : (
              <p className="mb-1.5 text-caption opacity-75">Photo unavailable</p>
            )
          ) : null}

          {message.voice ? (
            <div className="py-0.5">
              <VoicePlayer
                src={message.voice.url}
                durationMillis={message.voice.durationMillis}
                mine={mine}
              />
            </div>
          ) : null}

          {message.priceCard ? (
            <div className={cn(message.image || message.voice ? "mt-2" : "")}>
              <PriceCardBubble
                card={message.priceCard}
                mine={mine}
                peerExternalId={peerExternalId}
              />
            </div>
          ) : null}

          {hasBody ? (
            <p className="mt-0.5 whitespace-pre-wrap break-words text-body [overflow-wrap:anywhere]">
              {message.body}
            </p>
          ) : message.kind !== "image" && message.kind !== "voice" && message.kind !== "price_card" ? (
            <p className="text-caption italic opacity-70">Message removed</p>
          ) : null}

        </div>

        <div
          className={cn(
            "mt-0.5 flex items-center gap-1 px-1 text-[10px] text-muted",
            mine ? "justify-end" : "justify-start",
          )}
        >
          <time dateTime={new Date(message.createdAt).toISOString()} title={new Date(message.createdAt).toLocaleString()}>
            {formatTime(message.createdAt)}
          </time>
          {mine ? (
            <>
              <span>{read ? "Read" : "Sent"}</span>
              {read ? (
                <CheckCheck aria-hidden className="size-3.5" />
              ) : (
                <Check aria-hidden className="size-3.5" />
              )}
            </>
          ) : null}
        </div>

        <div
          ref={menuRef}
          className={cn(
            "absolute top-1 z-20 flex items-center gap-0.5 rounded-full border border-line bg-surface p-0.5 opacity-0 shadow-card transition focus-within:opacity-100 group-hover/message:opacity-100",
            mine ? "right-full mr-1.5" : "left-full ml-1.5",
            menuOpen && "opacity-100",
          )}
        >
          <button
            type="button"
            onClick={() => {
              onReply(reference);
              setMenuOpen(false);
            }}
            aria-label={`Reply to ${message.authorName}`}
            title="Reply"
            className="flex size-7 items-center justify-center rounded-full text-muted transition hover:bg-tint hover:text-ink focus-visible:opacity-100"
          >
            <CornerUpLeft aria-hidden className="size-3.5" />
          </button>
          {menuOpen ? (
            <>
              {mine ? (
                <button
                  type="button"
                  onClick={() => void removeMessage()}
                  disabled={removing}
                  aria-label="Remove message"
                  title="Remove message"
                  className="flex size-7 items-center justify-center rounded-full text-danger transition hover:bg-danger-surface disabled:opacity-50"
                >
                  {removing ? (
                    <Loader2 aria-hidden className="size-3.5 animate-spin" />
                  ) : (
                    <Trash2 aria-hidden className="size-3.5" />
                  )}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Close message actions"
                className="flex size-7 items-center justify-center rounded-full text-muted hover:bg-tint hover:text-ink"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="More message actions"
              title="More actions"
              className="flex size-7 items-center justify-center rounded-full text-muted transition hover:bg-tint hover:text-ink"
            >
              <MoreHorizontal aria-hidden className="size-3.5" />
            </button>
          )}
        </div>
        {removeError ? (
          <p role="alert" className="mt-1 text-[10px] text-danger">
            {removeError}
          </p>
        ) : null}
      </div>
    </li>
  );
}
