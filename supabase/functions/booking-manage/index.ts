import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  try{
    const authorization=request.headers.get('Authorization');
    if(!authorization)return json({error:'Authentication required'},401);
    const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}}});
    const{data:{user}}=await client.auth.getUser();
    if(!user)return json({error:'Authentication required'},401);
    const{bookingId,action,reason}=await request.json();
    if(!['confirm','complete','cancel','customer_cancel'].includes(action))return json({error:'Unknown appointment action'},400);
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const{data:booking}=await admin.from('bookings').select('id,customer_id,professional_id,starts_at,status,payment_status,price,deposit_amount,paystack_reference,professional_profiles!inner(user_id)').eq('id',bookingId).single();
    const owner=Array.isArray(booking?.professional_profiles)?booking.professional_profiles[0]:booking?.professional_profiles;
    const customerAction=action==='customer_cancel';
    if(!booking||(customerAction?booking.customer_id!==user.id:owner?.user_id!==user.id))return json({error:'Appointment not found'},404);
    const cancellationAction=action==='cancel'||customerAction;
    const{data:existingSettlement}=cancellationAction
      ?await admin.from('booking_cancellation_settlements').select('refund_status,refund_amount,professional_compensation').eq('booking_id',booking.id).maybeSingle()
      :{data:null};
    const retryingFailedRefund=booking.status==='cancelled'&&existingSettlement?.refund_status==='failed';
    if(action==='confirm'&&booking.status!=='requested')return json({error:'Only requested appointments can be confirmed'},409);
    if(action==='complete'&&booking.status!=='confirmed')return json({error:'Only confirmed appointments can be completed'},409);
    if(action==='complete'&&booking.payment_status!=='paid')return json({error:'Only paid appointments can be completed'},409);
    if(cancellationAction&&!['requested','confirmed'].includes(booking.status)&&!retryingFailedRefund)return json({error:'This appointment can no longer be cancelled'},409);

    if(cancellationAction&&!retryingFailedRefund){
      const{error:cancelError}=await admin.from('bookings').update({status:'cancelled',cancelled_at:new Date().toISOString(),cancellation_reason:typeof reason==='string'?reason.trim().slice(0,500):customerAction?'Cancelled by customer':null}).eq('id',booking.id).in('status',['requested','confirmed']);
      if(cancelError)return json({error:'The appointment could not be cancelled.'},500);
    }

    if(cancellationAction&&['paid','refund_pending'].includes(booking.payment_status)&&booking.paystack_reference){
      const depositPesewas=Math.round(Number(booking.deposit_amount)*100);
      const compensationPesewas=customerAction?Math.round(depositPesewas*0.10):0;
      const refundPesewas=depositPesewas-compensationPesewas;
      if(existingSettlement&&!retryingFailedRefund)return json({status:'cancelled',refund:existingSettlement.refund_status,refundAmount:Number(existingSettlement.refund_amount),professionalCompensation:Number(existingSettlement.professional_compensation)});
      const settlementWrite=retryingFailedRefund
        ?admin.from('booking_cancellation_settlements').update({refund_status:'processing',updated_at:new Date().toISOString()}).eq('booking_id',booking.id)
        :admin.from('booking_cancellation_settlements').insert({booking_id:booking.id,cancelled_by:customerAction?'customer':'professional',deposit_amount:depositPesewas/100,refund_amount:refundPesewas/100,professional_compensation:compensationPesewas/100,refund_status:'processing'});
      const{error:settlementError}=await settlementWrite;
      if(settlementError){
        console.error('Cancellation settlement insert failed',{bookingId:booking.id,code:settlementError.code,message:settlementError.message,details:settlementError.details,hint:settlementError.hint});
        return json({status:'cancelled',refund:'failed',warning:'The booking was cancelled, but its refund record could not be created. Deploy the latest database migration, then retry the refund.',supportCode:`settlement-${settlementError.code??'database'}`});
      }
      const response=await fetch('https://api.paystack.co/refund',{method:'POST',headers:{Authorization:`Bearer ${Deno.env.get('PAYSTACK_SECRET_KEY')}`,'Content-Type':'application/json'},body:JSON.stringify({transaction:booking.paystack_reference,amount:refundPesewas,currency:'GHS',customer_note:customerAction?'90% of your booking deposit is being refunded.':'Your full booking deposit is being refunded.',merchant_note:customerAction?'Customer cancellation: 10% paid to professional':typeof reason==='string'?reason.slice(0,200):'Appointment cancelled by professional'})});
      const payload=await response.json();
      if(!response.ok||!payload.status){await admin.from('booking_cancellation_settlements').update({refund_status:'failed',updated_at:new Date().toISOString()}).eq('booking_id',booking.id);return json({status:'cancelled',refund:'failed',refundAmount:refundPesewas/100,professionalCompensation:compensationPesewas/100,warning:payload.message??'The booking was cancelled, but Paystack could not queue the refund. Support must retry it.'})}
      const providerStatus=String(payload.data?.status??'processing');
      const refundStatus=providerStatus==='processed'?'refunded':providerStatus==='needs-attention'?'needs_attention':providerStatus==='pending'?'pending':'processing';
      await admin.from('booking_cancellation_settlements').update({refund_status:refundStatus,provider_refund_id:String(payload.data?.id??payload.data?.refund_reference??''),updated_at:new Date().toISOString()}).eq('booking_id',booking.id);

      if(customerAction&&compensationPesewas>0){
        await admin.from('payouts').insert({booking_id:booking.id,payout_type:'customer_cancellation',professional_id:booking.professional_id,amount:compensationPesewas/100,deposit_amount:depositPesewas/100,platform_fee:0,service_price:Number(booking.price),status:'paid',provider_reference:booking.paystack_reference,paid_at:new Date().toISOString()});
      }
      await admin.from('payments').update({status:refundStatus==='refunded'?'refunded':'refund_pending',provider_payload:payload,updated_at:new Date().toISOString()}).eq('provider_reference',booking.paystack_reference);
      await admin.from('bookings').update({payment_status:refundStatus==='refunded'?'refunded':'refund_pending'}).eq('id',booking.id);
      return json({status:'cancelled',refund:refundStatus,refundAmount:refundPesewas/100,professionalCompensation:compensationPesewas/100});
    }
    if(action==='complete'){
      const pricePesewas=Math.round(Number(booking.price)*100);
      const depositPesewas=Math.round(Number(booking.deposit_amount)*100);
      if(depositPesewas===0&&!booking.paystack_reference){
        const{error:completeError}=await admin.from('bookings').update({status:'completed'}).eq('id',booking.id).eq('status','confirmed');
        if(completeError)return json({error:'The appointment could not be marked completed.'},500);
        return json({status:'completed',refund:null,payout:null});
      }
      const platformFeePesewas=Math.round(depositPesewas*0.10);
      const payoutPesewas=depositPesewas-platformFeePesewas;
      if(payoutPesewas<=0)return json({error:'The deposit must be greater than Sheree’s 10% service fee.'},409);
      const{data:existingPayout}=await admin.from('payouts').select('id,status,provider_reference').eq('booking_id',booking.id).maybeSingle();
      if(existingPayout?.status==='paid'){
        await admin.from('bookings').update({status:'completed'}).eq('id',booking.id);
        return json({status:'completed',refund:null,payout:'paid'});
      }
      if(existingPayout)return json({error:'This appointment payout has already been recorded.'},409);

      const payoutWrite=admin.from('payouts').insert({booking_id:booking.id,professional_id:booking.professional_id,amount:payoutPesewas/100,deposit_amount:depositPesewas/100,platform_fee:platformFeePesewas/100,service_price:pricePesewas/100,status:'paid',provider_reference:booking.paystack_reference,paid_at:new Date().toISOString()}).select('id').single();
      const{data:payout,error:payoutError}=await payoutWrite;
      if(payoutError||!payout)return json({error:'The payout could not be prepared.'},500);

      const{error:completeError}=await admin.from('bookings').update({status:'completed'}).eq('id',booking.id).eq('status','confirmed');
      if(completeError)return json({error:'The payout was recorded, but the appointment could not be marked completed. Contact support.'},500);
      return json({status:'completed',refund:null,payout:'paid'});
    }
    if(action==='cancel'||customerAction)return json({status:'cancelled',refund:null});
    const update={status:'confirmed'};
    const{error}=await admin.from('bookings').update(update).eq('id',booking.id);
    if(error)return json({error:'The appointment could not be updated'},500);
    return json({status:update.status,refund:null});
  }catch(error){return json({error:error instanceof Error?error.message:'Unexpected appointment error'},500)}
});
