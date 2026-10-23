import { MessagesPlaceholder } from "@/features/messaging/MessagesShell";

/**
 * The list itself is drawn by `MessagesShell`, which keeps it on screen next to
 * the open thread. This page only supplies the pane shown on a wide window
 * before a conversation is picked; on a phone it stays hidden.
 */
export default function MessagesPage() {
  return <MessagesPlaceholder />;
}
