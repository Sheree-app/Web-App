"use client";

import { useMutation } from "convex/react";
import {
  Image as ImageIcon,
  Loader2,
  Mic,
  Receipt,
  RotateCcw,
  Send,
  Square,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { MAX_VOICE_MS, useVoiceRecorder } from "./use-voice-recorder";
import { formatDuration } from "./format";
import { formatBytes, prepareChatImage, uploadToConvex, type PreparedImage } from "./web-media";
import { VoicePlayer } from "./VoicePlayer";
import type { ReplyReference } from "./types";

const MAX_BODY = 4000;
const MAX_CAPTION = 400;
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";

type ImageStage = "idle" | "preparing" | "ready" | "uploading" | "error";
type VoiceStage = "idle" | "uploading" | "error";

/**
 * The composer.
 *
 * Text sends immediately and optimistically (the thread owns the pending
 * bubble); photos and voice notes stay in a preview until the person confirms,
 * upload privately to Convex storage, and report real progress. Enter sends,
 * Shift+Enter makes a newline, and focus is never trapped here.
 */
export function MessageComposer({
  conversationId,
  draft,
  onDraftChange,
  replyTo,
  onCancelReply,
  onSendText,
  onSendImage,
  onSendVoice,
  canCreatePriceCard,
  onOpenPriceCard,
  onTyping,
  online,
}: {
  conversationId: Id<"conversations">;
  draft: string;
  onDraftChange: (value: string) => void;
  replyTo: ReplyReference | null;
  onCancelReply: () => void;
  onSendText: (body: string, replyToMessageId?: Id<"messages">) => Promise<boolean>;
  onSendImage: (input: {
    storageId: Id<"_storage">;
    width: number;
    height: number;
    mimeType: string;
    sizeBytes: number;
    caption: string;
    replyToMessageId?: Id<"messages">;
  }) => Promise<void>;
  onSendVoice: (input: {
    storageId: Id<"_storage">;
    durationMillis: number;
    mimeType: string;
    sizeBytes: number;
    replyToMessageId?: Id<"messages">;
  }) => Promise<void>;
  canCreatePriceCard: boolean;
  onOpenPriceCard: () => void;
  onTyping: (hasText: boolean) => void;
  online: boolean;
}) {
  const generateUploadUrl = useMutation(api.messages.generateUploadUrl);
  const voice = useVoiceRecorder();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageAbortRef = useRef<AbortController | null>(null);
  const voiceAbortRef = useRef<AbortController | null>(null);
  const dragDepth = useRef(0);

  const [sendingText, setSendingText] = useState(false);
  const [textError, setTextError] = useState("");
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [imageStage, setImageStage] = useState<ImageStage>("idle");
  const [imageProgress, setImageProgress] = useState(0);
  const [imageError, setImageError] = useState("");
  const [caption, setCaption] = useState("");
  const [voiceStage, setVoiceStage] = useState<VoiceStage>("idle");
  const [voiceProgress, setVoiceProgress] = useState(0);
  const [voiceError, setVoiceError] = useState("");
  const [dragging, setDragging] = useState(false);

  const clearImage = () => {
    imageAbortRef.current?.abort();
    imageAbortRef.current = null;
    setImage((current) => {
      current?.dispose();
      return null;
    });
    setImageStage("idle");
    setImageProgress(0);
    setImageError("");
    setCaption("");
  };

  useEffect(
    () => () => {
      imageAbortRef.current?.abort();
      voiceAbortRef.current?.abort();
    },
    [],
  );

  // Auto-grow the textarea up to roughly four lines.
  useEffect(() => {
    const node = textareaRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, 132)}px`;
  }, [draft]);

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setImageError("Choose a photo — JPEG, PNG or WebP.");
      setImageStage("error");
      return;
    }
    setImageError("");
    setImageStage("preparing");
    try {
      const prepared = await prepareChatImage(file);
      setImage(prepared);
      setImageStage("ready");
    } catch (cause) {
      setImageStage("error");
      setImageError(
        cause instanceof Error ? cause.message : "That image couldn't be prepared. Try another.",
      );
    }
  };

  // Drag-and-drop anywhere over the thread, without hijacking ordinary drags.
  useEffect(() => {
    const isFileDrag = (event: globalThis.DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const onDragEnter = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const onDragOver = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
    };
    const onDragLeave = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (event: globalThis.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      void pickFile(event.dataTransfer?.files?.[0]);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  });

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    void pickFile(file);
  };

  const sendImage = async () => {
    if (!image || imageStage === "uploading") return;
    setImageError("");
    setImageStage("uploading");
    setImageProgress(0);
    const controller = new AbortController();
    imageAbortRef.current = controller;
    try {
      const uploadUrl = await generateUploadUrl({ conversationId });
      const storageId = await uploadToConvex(uploadUrl, image.file, {
        contentType: image.mimeType,
        onProgress: setImageProgress,
        signal: controller.signal,
      });
      await onSendImage({
        storageId,
        width: image.width,
        height: image.height,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        caption: caption.trim(),
        replyToMessageId: replyTo?.messageId,
      });
      clearImage();
    } catch (cause) {
      setImageStage("error");
      setImageError(
        cause instanceof Error ? cause.message : "That photo could not be sent. Try again.",
      );
    } finally {
      imageAbortRef.current = null;
    }
  };

  const sendVoice = async () => {
    if (!voice.recording || voiceStage === "uploading") return;
    setVoiceError("");
    setVoiceStage("uploading");
    setVoiceProgress(0);
    const controller = new AbortController();
    voiceAbortRef.current = controller;
    try {
      const uploadUrl = await generateUploadUrl({ conversationId });
      const storageId = await uploadToConvex(uploadUrl, voice.recording.file, {
        contentType: voice.recording.mimeType,
        onProgress: setVoiceProgress,
        signal: controller.signal,
      });
      await onSendVoice({
        storageId,
        durationMillis: voice.recording.durationMillis,
        mimeType: voice.recording.mimeType,
        sizeBytes: voice.recording.blob.size,
        replyToMessageId: replyTo?.messageId,
      });
      setVoiceStage("idle");
      setVoiceProgress(0);
      voice.reset();
    } catch (cause) {
      setVoiceStage("error");
      setVoiceError(
        cause instanceof Error ? cause.message : "That voice note could not be sent. Try again.",
      );
    } finally {
      voiceAbortRef.current = null;
    }
  };

  const submitText = async (event?: FormEvent) => {
    event?.preventDefault();
    const body = draft.trim();
    if (!body || sendingText || body.length > MAX_BODY) return;
    setSendingText(true);
    setTextError("");
    const ok = await onSendText(body, replyTo?.messageId);
    // Whether it succeeded or failed, the text now lives in the thread: on
    // failure it is the retryable bubble, so keeping a second copy here would
    // invite a duplicate send under a new idempotency key.
    onDraftChange("");
    onTyping(false);
    onCancelReply();
    if (!ok) {
      setTextError("Your message wasn’t sent. It’s saved in the thread — tap Retry.");
    }
    setSendingText(false);
    window.requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    // IME composition must never be interrupted by a send.
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submitText();
  };

  const charCount = draft.length;
  const busyWithMedia = image !== null || voice.recording !== null || voice.state === "recording";

  return (
    <>
      {dragging ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-overlay/60 p-6">
          <div className="rounded-card border-2 border-dashed border-primary bg-surface px-8 py-6 text-center shadow-lift">
            <ImageIcon aria-hidden className="mx-auto size-8 text-primary" />
            <p className="mt-2 text-body font-bold text-ink">Drop a photo to send</p>
            <p className="text-caption text-muted">JPEG, PNG or WebP · up to 10 MB</p>
          </div>
        </div>
      ) : null}

      <form
        onSubmit={(event) => void submitText(event)}
        className="shrink-0 border-t border-line bg-surface px-3 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]"
      >
        {replyTo ? (
          <div className="mb-2 flex items-start gap-2 rounded-field border-l-2 border-primary bg-tint px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[1.2px] text-primary">
                Replying to {replyTo.authorName}
              </p>
              <p className="truncate text-caption text-muted">{replyTo.preview}</p>
            </div>
            <button
              type="button"
              onClick={onCancelReply}
              aria-label="Cancel reply"
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface hover:text-ink"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>
        ) : null}

        {image || imageStage === "preparing" || imageStage === "error" ? (
          <div className="mb-2 overflow-hidden rounded-panel border border-line bg-background">
            {image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={image.previewUrl}
                alt="Photo ready to send"
                className="max-h-52 w-full object-cover"
              />
            ) : (
              <div className="flex h-24 items-center justify-center text-caption text-muted">
                {imageStage === "preparing" ? (
                  <>
                    <Loader2 aria-hidden className="mr-2 size-4 animate-spin" />
                    Preparing your photo…
                  </>
                ) : (
                  "No photo selected"
                )}
              </div>
            )}
            <div className="p-3">
              <label className="sr-only" htmlFor="chat-image-caption">
                Photo caption
              </label>
              <input
                id="chat-image-caption"
                value={caption}
                onChange={(event) => setCaption(event.target.value)}
                maxLength={MAX_CAPTION}
                placeholder="Add a caption (optional)"
                className="min-h-10 w-full rounded-field border border-line bg-surface px-3 text-caption text-ink outline-none focus:border-primary"
              />
              {imageStage === "uploading" ? (
                <div className="mt-2">
                  <div className="h-1.5 overflow-hidden rounded-full bg-line">
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${Math.round(imageProgress * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-muted" aria-live="polite">
                    Uploading {Math.round(imageProgress * 100)}%
                    {image ? ` · ${formatBytes(image.sizeBytes)}` : ""}
                  </p>
                </div>
              ) : null}
              {imageError ? (
                <p role="alert" className="mt-2 text-[11px] text-danger">
                  {imageError}
                </p>
              ) : null}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={clearImage}
                  disabled={imageStage === "uploading"}
                  className="min-h-10 flex-1 rounded-field border border-line text-caption font-medium text-muted transition hover:bg-tint disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void sendImage()}
                  disabled={!image || imageStage === "uploading" || imageStage === "preparing"}
                  className="flex min-h-10 flex-1 items-center justify-center gap-2 rounded-field bg-primary text-caption font-bold text-surface transition disabled:opacity-45"
                >
                  {imageStage === "uploading" ? (
                    <Loader2 aria-hidden className="size-4 animate-spin" />
                  ) : imageStage === "error" ? (
                    <RotateCcw aria-hidden className="size-4" />
                  ) : (
                    <Send aria-hidden className="size-4" />
                  )}
                  {imageStage === "uploading" ? "Sending…" : imageStage === "error" ? "Retry" : "Send photo"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {voice.state === "recording" ? (
          <div className="mb-2 flex items-center gap-3 rounded-field bg-danger-surface px-3 py-2.5">
            <span className="size-2.5 animate-pulse-soft rounded-full bg-danger" />
            <div className="min-w-0 flex-1">
              <p className="text-caption font-bold text-ink">Recording…</p>
              <p className="text-[11px] tabular-nums text-muted">
                {formatDuration(voice.elapsed)} / {formatDuration(MAX_VOICE_MS)}
              </p>
            </div>
            <button
              type="button"
              onClick={voice.cancel}
              className="min-h-9 rounded-field px-3 text-caption font-medium text-muted transition hover:bg-surface"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={voice.stop}
              className="flex min-h-9 items-center gap-1.5 rounded-field bg-danger px-3 text-caption font-bold text-surface"
            >
              <Square aria-hidden className="size-3.5" />
              Review
            </button>
          </div>
        ) : voice.recording ? (
          <div className="mb-2 rounded-field border border-line bg-background px-3 py-2.5">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <VoicePlayer
                  src={voice.recording.url}
                  durationMillis={voice.recording.durationMillis}
                  mine={false}
                />
              </div>
            </div>
            {voiceStage === "uploading" ? (
              <div className="mt-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${Math.round(voiceProgress * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-muted" aria-live="polite">
                  Uploading {Math.round(voiceProgress * 100)}%
                </p>
              </div>
            ) : null}
            {voiceError ? (
              <p role="alert" className="mt-2 text-[11px] text-danger">
                {voiceError}
              </p>
            ) : null}
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  voiceAbortRef.current?.abort();
                  setVoiceStage("idle");
                  setVoiceError("");
                  voice.reset();
                }}
                disabled={voiceStage === "uploading"}
                className="min-h-9 flex-1 rounded-field border border-line text-caption font-medium text-muted transition hover:bg-tint disabled:opacity-50"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => void sendVoice()}
                disabled={voiceStage === "uploading"}
                className="flex min-h-9 flex-1 items-center justify-center gap-2 rounded-field bg-primary text-caption font-bold text-surface disabled:opacity-45"
              >
                {voiceStage === "uploading" ? (
                  <Loader2 aria-hidden className="size-4 animate-spin" />
                ) : (
                  <Send aria-hidden className="size-4" />
                )}
                {voiceStage === "uploading"
                  ? "Sending…"
                  : voiceStage === "error"
                    ? "Retry"
                    : "Send voice note"}
              </button>
            </div>
          </div>
        ) : null}

        {voice.error && voice.state === "idle" && !voice.recording ? (
          <p role="alert" className="mb-2 flex items-start gap-2 rounded-field bg-danger-surface px-3 py-2 text-[11px] text-danger">
            <span className="flex-1">{voice.error}</span>
            <button
              type="button"
              onClick={voice.clearError}
              aria-label="Dismiss microphone message"
              className="text-danger/70 hover:text-danger"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </p>
        ) : null}

        {textError ? (
          <p role="alert" className="mb-2 text-caption text-danger">
            {textError}
          </p>
        ) : null}

        <div className="flex items-end gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            accept={IMAGE_ACCEPT}
            onChange={onFileChange}
            className="sr-only"
            aria-label="Attach a photo"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach a photo"
            title="Attach a photo"
            disabled={busyWithMedia}
            className="mb-0.5 flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-tint hover:text-ink disabled:opacity-40"
          >
            <ImageIcon aria-hidden className="size-5" />
          </button>

          <button
            type="button"
            onClick={() => (voice.state === "recording" ? voice.stop() : voice.start())}
            aria-label={voice.state === "recording" ? "Stop recording" : "Record a voice note"}
            title={voice.supported ? "Record a voice note" : "Voice notes are not supported in this browser"}
            disabled={busyWithMedia && voice.state !== "recording"}
            className={cn(
              "mb-0.5 flex size-11 shrink-0 items-center justify-center rounded-full transition disabled:opacity-40",
              voice.state === "recording"
                ? "bg-danger-surface text-danger"
                : "text-muted hover:bg-tint hover:text-ink",
            )}
          >
            <Mic aria-hidden className="size-5" />
          </button>

          {canCreatePriceCard ? (
            <button
              type="button"
              onClick={onOpenPriceCard}
              aria-label="Send a price card"
              title="Send a price card"
              className="mb-0.5 flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-tint hover:text-ink"
            >
              <Receipt aria-hidden className="size-5" />
            </button>
          ) : null}

          <label className="min-w-0 flex-1">
            <span className="sr-only">Message</span>
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => {
                onDraftChange(event.target.value);
                onTyping(event.target.value.trim().length > 0);
              }}
              onBlur={() => onTyping(false)}
              onKeyDown={onKeyDown}
              maxLength={MAX_BODY}
              rows={1}
              disabled={sendingText}
              placeholder={online ? "Write a message…" : "You’re offline — messages will retry"}
              aria-describedby="chat-char-count"
              className="block max-h-[132px] min-h-11 w-full resize-none overflow-y-auto rounded-panel border border-line bg-background px-4 py-2.5 text-body text-ink outline-none transition focus:border-primary"
            />
          </label>

          <button
            type="submit"
            disabled={sendingText || !draft.trim() || charCount > MAX_BODY}
            aria-label={sendingText ? "Sending message" : "Send message"}
            className="mb-0.5 flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-surface transition disabled:opacity-40"
          >
            {sendingText ? (
              <Loader2 aria-hidden className="size-5 animate-spin" />
            ) : (
              <Send aria-hidden className="size-[18px]" />
            )}
          </button>
        </div>
        <div className="mt-1 flex items-center justify-between px-1">
          <span className="text-[10px] text-muted">
            Enter to send · Shift + Enter for a new line
          </span>
          <span
            id="chat-char-count"
            className={cn(
              "text-[10px] tabular-nums",
              charCount > MAX_BODY * 0.9 ? "text-danger" : "text-muted",
            )}
          >
            {charCount}/{MAX_BODY}
          </span>
        </div>
      </form>
    </>
  );
}
