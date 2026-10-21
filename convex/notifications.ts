import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { sendMessageNotification } from "./lib/supabase";

/**
 * Chat notifications deliberately reuse Sheree's existing notification system:
 * inserting into the `notifications` table fires the established delivery
 * trigger, which respects the recipient's preferences/quiet hours and pushes to
 * their registered devices. No parallel notification stack is introduced, and
 * the deep link is keyed on the conversation id — never on app mode.
 *
 * Failures here are swallowed on purpose. A push that cannot be queued must
 * never make sending a message look like it failed.
 */
export const notifyMessage = internalAction({
  args: {
    conversationId: v.id("conversations"),
    recipientExternalId: v.string(),
    senderName: v.string(),
    preview: v.string(),
  },
  handler: async (_ctx, args) => {
    try {
      await sendMessageNotification({
        recipientId: args.recipientExternalId,
        conversationId: args.conversationId,
        senderName: args.senderName,
        preview: args.preview.slice(0, 160),
      });
    } catch (error) {
      console.warn("[Sheree messaging] message notification skipped", error);
    }
  },
});

/** Notifies the customer that a custom price card is waiting for them. */
export const notifyPriceCard = internalAction({
  args: {
    conversationId: v.id("conversations"),
    recipientExternalId: v.string(),
    senderName: v.string(),
    serviceName: v.string(),
  },
  handler: async (_ctx, args) => {
    try {
      await sendMessageNotification({
        recipientId: args.recipientExternalId,
        conversationId: args.conversationId,
        senderName: args.senderName,
        preview: `${args.serviceName} — tap to book`,
      });
    } catch (error) {
      console.warn("[Sheree messaging] price card notification skipped", error);
    }
  },
});
