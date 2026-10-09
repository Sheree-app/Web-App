import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const reply = (status = 200) => new Response(null, { status });

Deno.serve(async (request) => {
  if (request.method !== 'POST') return reply(405);
  const secret = Deno.env.get('PAYSTACK_SECRET_KEY');
  if (!secret) return reply(500);
  const raw = await request.text();
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const signature = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  if (signature !== request.headers.get('x-paystack-signature')) return reply(401);

  const event = JSON.parse(raw);
  const data = event?.data;
  const reference = (data?.transaction_reference ?? data?.reference ?? data?.transaction?.reference) as string | undefined;
  if (!reference) return reply();
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  if (event.event === 'transfer.success' || event.event === 'transfer.failed' || event.event === 'transfer.reversed') {
    const status = event.event === 'transfer.success' ? 'paid' : event.event === 'transfer.reversed' ? 'reversed' : 'failed';
    await admin.from('payouts').update({
      status,
      failure_reason: status === 'failed' ? data?.gateway_response ?? data?.message ?? 'Transfer failed' : null,
      paid_at: status === 'paid' ? data?.transferred_at ?? new Date().toISOString() : null,
    }).eq('provider_reference', reference);
    return reply();
  }

  const { data: payment } = await admin.from('payments').select('id,booking_id,amount,currency,status').eq('provider_reference', reference).maybeSingle();
  if (!payment) return reply();

  if (event.event === 'charge.success') {
    const valid = data.status === 'success' && Number(data.amount) === Math.round(Number(payment.amount) * 100) && data.currency === payment.currency && data.metadata?.booking_id === payment.booking_id;
    if (!valid) return reply(400);
    const paidAt = data.paid_at ?? new Date().toISOString();
    await admin.from('payments').update({ status: 'paid', channel: data.channel ?? null, gateway_response: data.gateway_response ?? null, paid_at: paidAt, provider_payload: event, updated_at: new Date().toISOString() }).eq('id', payment.id);
    await admin.from('bookings').update({ payment_status: 'paid', deposit_paid_at: paidAt }).eq('id', payment.booking_id).neq('payment_status', 'refunded');
  } else if (event.event === 'refund.processed' || event.event === 'charge.dispute.create') {
    await admin.from('payments').update({ status: 'refunded', provider_payload: event, updated_at: new Date().toISOString() }).eq('id', payment.id);
    await admin.from('bookings').update({ payment_status: 'refunded' }).eq('id', payment.booking_id);
    if (event.event === 'refund.processed') await admin.from('booking_cancellation_settlements').update({ refund_status: 'refunded', updated_at: new Date().toISOString() }).eq('booking_id', payment.booking_id);
  } else if (event.event === 'refund.pending' || event.event === 'refund.processing') {
    await admin.from('payments').update({ status: 'refund_pending', provider_payload: event, updated_at: new Date().toISOString() }).eq('id', payment.id);
    await admin.from('bookings').update({ payment_status: 'refund_pending' }).eq('id', payment.booking_id);
    await admin.from('booking_cancellation_settlements').update({
      refund_status: event.event === 'refund.pending' ? 'pending' : 'processing',
      provider_refund_id: data?.refund_reference ?? undefined,
      updated_at: new Date().toISOString(),
    }).eq('booking_id', payment.booking_id);
  } else if (event.event === 'refund.needs-attention') {
    await admin.from('payments').update({ status: 'refund_pending', provider_payload: event, updated_at: new Date().toISOString() }).eq('id', payment.id);
    await admin.from('bookings').update({ payment_status: 'refund_pending' }).eq('id', payment.booking_id);
    await admin.from('booking_cancellation_settlements').update({
      refund_status: 'needs_attention',
      provider_refund_id: data?.refund_reference ?? undefined,
      updated_at: new Date().toISOString(),
    }).eq('booking_id', payment.booking_id);
  } else if (event.event === 'refund.failed') {
    await admin.from('payments').update({ status: 'refund_pending', provider_payload: event, updated_at: new Date().toISOString() }).eq('id', payment.id);
    await admin.from('booking_cancellation_settlements').update({ refund_status: 'failed', updated_at: new Date().toISOString() }).eq('booking_id', payment.booking_id);
  }
  return reply();
});
