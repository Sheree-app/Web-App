import { bookingDueNow, toPesewas, toCedis } from '../../../src/lib/pricing.ts';
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
    if (!user?.email) return json({ error: 'A verified email address is required' }, 401);
    const { bookingId, callbackUrl } = await request.json();
    const { data: booking, error } = await client.from('bookings').select('id,professional_id,price,deposit_amount,sheree_fee_amount,currency,payment_status,paystack_reference,professional_profiles!inner(user_id)').eq('id', bookingId).eq('customer_id', user.id).single();
    if (error || !booking) return json({ error: 'Booking not found' }, 404);
    const professional = Array.isArray(booking.professional_profiles) ? booking.professional_profiles[0] : booking.professional_profiles;
    if (professional?.user_id === user.id) return json({ error: 'You cannot book your own service.' }, 409);
    if (booking.payment_status !== 'pending') return json({ error: 'This deposit is not awaiting payment' }, 409);
    const amount = bookingDueNow(booking);
    if (amount < 1) {
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
      await admin.from('bookings').update({ payment_status: 'paid', deposit_paid_at: new Date().toISOString() }).eq('id', booking.id).eq('payment_status', 'pending');
      return json({ paid: true });
    }
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: payoutAccount } = await admin.from('professional_payout_accounts').select('paystack_subaccount_code').eq('professional_id', booking.professional_id).maybeSingle();
    if (!payoutAccount?.paystack_subaccount_code) return json({ error: 'This professional has not connected a payout account yet.' }, 409);
    const transactionCharge = booking.sheree_fee_amount == null ? Math.round(Number(booking.deposit_amount) * 10) : toPesewas(Number(booking.sheree_fee_amount));
    if (transactionCharge >= amount) return json({ error: 'The deposit must be greater than Sheree’s service fee.' }, 409);
    const response = await fetch('https://api.paystack.co/transaction/initialize', { method: 'POST', headers: { Authorization: `Bearer ${Deno.env.get('PAYSTACK_SECRET_KEY')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, amount, currency: booking.currency, channels: ['card', 'mobile_money', 'bank_transfer'], subaccount: payoutAccount.paystack_subaccount_code, transaction_charge: transactionCharge, bearer: 'account', callback_url: typeof callbackUrl === 'string' ? callbackUrl : undefined, metadata: { booking_id: booking.id, customer_id: user.id, professional_id: booking.professional_id } }) });
    const payload = await response.json();
    if (!response.ok || !payload.status) return json({ error: payload.message ?? 'Unable to initialize payment' }, 502);
    const { error: updateError } = await admin.from('bookings').update({ paystack_reference: payload.data.reference }).eq('id', booking.id).eq('payment_status', 'pending');
    if (updateError) return json({ error: 'Unable to attach payment to booking' }, 500);
    const { error: paymentError } = await admin.from('payments').insert({ booking_id: booking.id, customer_id: user.id, provider_reference: payload.data.reference, amount: toCedis(amount), currency: booking.currency, status: 'pending' });
    if (paymentError) return json({ error: 'Unable to record payment attempt' }, 500);
    return json({ accessCode: payload.data.access_code, authorizationUrl: payload.data.authorization_url, reference: payload.data.reference });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Unexpected payment error' }, 500);
  }
});
