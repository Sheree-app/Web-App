import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';
export type PayoutMethod='ghipss'|'mobile_money';
export type PayoutInstitution={name:string;code:string;type:string};
export type PayoutAccount={configured:boolean;method:PayoutMethod|null;institutionName:string|null;accountName:string|null;last4:string|null;configuredAt:string|null};
const invoke=async<T>(options?:{method?:'GET'|'POST';body?:unknown;query?:string})=>{const{data:{session}}=await supabase.auth.getSession();if(!session)throw new Error('Sign in to manage payouts.');const base=env.supabaseUrl;if(!base)throw new Error('Supabase is not configured.');const response=await fetch(`${base}/functions/v1/payout-account${options?.query??''}`,{method:options?.method??'GET',headers:{Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:options?.body?JSON.stringify(options.body):undefined});const payload=await response.json();if(!response.ok)throw new Error(payload.error??'Payout setup failed.');return payload as T};
export const fetchPayoutAccount=async()=> (await invoke<{account:PayoutAccount}>()).account;
export const fetchPayoutInstitutions=async(method:PayoutMethod)=>(await invoke<{institutions:PayoutInstitution[]}>({query:`?type=${method}`})).institutions;
export const savePayoutAccount=async(input:{method:PayoutMethod;bankCode:string;institutionName:string;accountNumber:string;accountName?:string})=>(await invoke<{account:PayoutAccount}>({method:'POST',body:input})).account;
