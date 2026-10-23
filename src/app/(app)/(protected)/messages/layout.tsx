import { AuthGuard } from "@/components/shell/auth-guard";
import { MessagingGate } from "@/features/messaging/MessagingGate";
import { MessagesShell } from "@/features/messaging/MessagesShell";

/**
 * Shared frame for the inbox and an open thread. `MessagesShell` arranges the
 * two routes side by side on a wide window and hands the phone the single pane
 * each route has always rendered.
 */
export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <MessagingGate>
        <MessagesShell>{children}</MessagesShell>
      </MessagingGate>
    </AuthGuard>
  );
}
