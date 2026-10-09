import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});
const paystack=(path:string,secret:string,init?:RequestInit)=>fetch(`https://api.paystack.co${path}`,{...init,headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json',...(init?.headers??{})}});

Deno.serve(async(request)=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  if(!['GET','POST'].includes(request.method))return json({error:'Method not allowed'},405);
  try{
    const authorization=request.headers.get('Authorization');
    const secret=Deno.env.get('PAYSTACK_SECRET_KEY');
    if(!authorization)return json({error:'Authentication required'},401);
    if(!secret)return json({error:'Paystack is not configured'},503);
    const client=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}}});
    const{data:{user}}=await client.auth.getUser();
    if(!user)return json({error:'Authentication required'},401);
    const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const{data:profile}=await admin.from('professional_profiles').select('id,display_name,business_name').eq('user_id',user.id).single();
    if(!profile)return json({error:'Professional profile not found'},404);

    if(request.method==='GET'){
      const type=new URL(request.url).searchParams.get('type');
      if(type==='ghipss'||type==='mobile_money'){
        const response=await paystack(`/bank?currency=GHS&type=${type}`,secret);
        const payload=await response.json();
        if(!response.ok||!payload.status)return json({error:payload.message??'Payout providers could not load'},502);
        const institutions=(payload.data??[]).filter((item:{active?:boolean;name?:string})=>item.active!==false&&item.name!=='Bank of Ghana').map((item:{name:string;code:string;type:string})=>({name:item.name,code:item.code,type:item.type}));
        return json({institutions});
      }
      const{data:payoutAccount,error:payoutAccountError}=await admin.from('professional_payout_accounts').select('paystack_subaccount_code,payout_method,institution_name,account_name,account_last4,configured_at').eq('professional_id',profile.id).maybeSingle();
      if(payoutAccountError){
        console.error('payout-account lookup failed',{professionalId:profile.id,code:payoutAccountError.code,message:payoutAccountError.message,details:payoutAccountError.details});
        return json({error:'Payout accounts are temporarily unavailable. Contact support.'},503);
      }
      return json({account:{configured:Boolean(payoutAccount?.paystack_subaccount_code),method:payoutAccount?.payout_method??null,institutionName:payoutAccount?.institution_name??null,accountName:payoutAccount?.account_name??null,last4:payoutAccount?.account_last4??null,configuredAt:payoutAccount?.configured_at??null}});
    }

    const body=await request.json();
    const method=body.method==='mobile_money'?'mobile_money':body.method==='ghipss'?'ghipss':null;
    const accountNumber=String(body.accountNumber??'').replace(/\s+/g,'');
    const bankCode=String(body.bankCode??'').trim();
    const institutionName=String(body.institutionName??'').trim();
    if(!method||!bankCode||!institutionName||!/^\d{10,20}$/.test(accountNumber))return json({error:method==='mobile_money'?'Enter a valid mobile money number.':'Enter valid payout account details.'},400);

    let accountName=String(body.accountName??profile.display_name??profile.business_name??'').trim();
    if(method==='ghipss'){
      const verify=await paystack(`/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,secret);
      const verified=await verify.json();
      if(!verify.ok||!verified.status)return json({error:verified.message??'Paystack could not verify this account number.'},400);
      accountName=String(verified.data?.account_name??accountName).trim();
    }
    if(accountName.length<2)return json({error:'Enter the name registered on this payout account.'},400);
    const{data:current}=await admin.from('professional_payout_accounts').select('paystack_subaccount_code').eq('professional_id',profile.id).maybeSingle();
    const subaccountBody={business_name:String(profile.business_name??profile.display_name??accountName),bank_code:bankCode,settlement_bank:bankCode,account_number:accountNumber,percentage_charge:0,description:`Sheree professional ${profile.id}`,primary_contact_name:accountName,primary_contact_email:user.email,metadata:JSON.stringify({professional_id:profile.id})};
    // The stored subaccount may have been created under a different Paystack
    // environment (e.g. with test keys before switching to live). The current
    // key cannot update it (404 "Subaccount not found"), so fall back to
    // creating a fresh subaccount under the current key.
    let response=await paystack(current?.paystack_subaccount_code?`/subaccount/${encodeURIComponent(current.paystack_subaccount_code)}`:'/subaccount',secret,{method:current?.paystack_subaccount_code?'PUT':'POST',body:JSON.stringify(subaccountBody)});
    let payload=await response.json();
    if(current?.paystack_subaccount_code&&(!response.ok||!payload.status||!payload.data?.subaccount_code)){
      response=await paystack('/subaccount',secret,{method:'POST',body:JSON.stringify(subaccountBody)});
      payload=await response.json();
    }
    if(!response.ok||!payload.status||!payload.data?.subaccount_code)return json({error:payload.message??'Paystack could not create this payout account.'},400);
    const configuredAt=new Date().toISOString();
    const subaccountCode=String(payload.data.subaccount_code);
    const accountRow={professional_id:profile.id,paystack_subaccount_code:subaccountCode,payout_method:method,institution_name:institutionName,account_name:String(payload.data.account_name??accountName),account_last4:accountNumber.slice(-4),configured_at:configuredAt,updated_at:configuredAt};
    const{error}=await admin.from('professional_payout_accounts').upsert(accountRow,{onConflict:'professional_id'});
    if(error){
      const{data:existing}=await admin.from('professional_payout_accounts').select('professional_id').eq('paystack_subaccount_code',subaccountCode).maybeSingle();
      if(existing?.professional_id!==profile.id){
        const reference=crypto.randomUUID();
        console.error('payout-account save failed',{reference,professionalId:profile.id,code:error.code,message:error.message,details:error.details,hint:error.hint});
        return json({error:`The payout account could not be saved. Contact support with reference ${reference}.`},500);
      }
    }
    return json({account:{configured:true,method,institutionName,accountName,last4:accountNumber.slice(-4),configuredAt}});
  }catch(error){return json({error:error instanceof Error?error.message:'Unexpected payout setup error'},500)}
});
