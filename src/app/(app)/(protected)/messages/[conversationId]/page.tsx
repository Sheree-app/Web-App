import { Conversation } from "@/features/messaging/Conversation";
export default async function ConversationPage({ params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  return <Conversation key={conversationId} conversationId={conversationId} />;
}
