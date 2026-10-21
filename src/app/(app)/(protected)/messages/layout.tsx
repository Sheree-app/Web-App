import { AuthGuard } from "@/components/shell/auth-guard";
import { MessagingGate } from "@/features/messaging/MessagingGate";
export default function MessagesLayout({ children }: { children: React.ReactNode }) {
  return <AuthGuard><MessagingGate>{children}</MessagingGate></AuthGuard>;
}
