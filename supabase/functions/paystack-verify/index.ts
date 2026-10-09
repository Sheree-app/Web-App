import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization) return json({ error: 'Authentication required' }, 401);
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
    const { data: { user } } = await client.auth.getUser();
    if (!user) return json({ error: 'Authentication required' }, 401);
    const { bookingId, reference } = await request.json();
    const { data: booking, error } = await client.from('bookings').select('id,deposit_amount,payment_status,paystack_reference').eq('id', bookingId).eq('customer_id', user.id).single();
    if (error || !booking || booking.paystack_reference !== reference) return json({ error: 'Payment does not match this booking' }, 400);
    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${Deno.env.get('PAYSTACK_SECRET_KEY')}` } });
    const payload = await response.json();
    const expected = Math.round(Number(booking.deposit_amount) * 100);
    if (!response.ok || !payload.status || payload.data.status !== 'success' || payload.data.amount !== expected || payload.data.currency !== 'GHS' || payload.data.metadata?.booking_id !== booking.id) return json({ error: 'Paystack could not verify this deposit' }, 402);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { error: updateError } = await admin.from('bookings').update({ payment_status: 'paid', deposit_paid_at: new Date().toISOString() }).eq('id', booking.id).eq('paystack_reference', reference);
    if (updateError) return json({ error: 'Payment was verified but the booking could not be updated' }, 500);
    await admin.from('payments').update({ status: 'paid', channel: payload.data.channel ?? null, gateway_response: payload.data.gateway_response ?? null, paid_at: payload.data.paid_at ?? new Date().toISOString(), provider_payload: payload, updated_at: new Date().toISOString() }).eq('provider_reference', reference);
    return json({ paid: true });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unexpected verification error' }, 500);
  }
});
