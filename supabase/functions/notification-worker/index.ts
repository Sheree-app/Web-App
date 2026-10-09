import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { sendWebPush, vapidKeysFromEnv, type WebPushSubscription } from '../_shared/web-push.ts';

type Notice={id:string;user_id:string;title:string;body:string;url:string|null;data:Record<string,unknown>;delivery_attempts:number};
type Token={id:string;expo_push_token:string|null;web_push_subscription:WebPushSubscription|null};
type ExpoTicket={status:'ok'|'error';id?:string;message?:string;details?:{error?:string}};

const EXPO_SEND='https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS='https://exp.host/--/api/v2/push/getReceipts';

/**
 * Where a notification should take the reader. Mirrors `notificationDestination`
 * in `src/features/notifications/api.ts` so a push and the in-app inbox open the
 * same place; the service worker falls back to `/notifications`.
 */
function destinationFor(notice:Notice):string{
  const data=notice.data??{};
  const text=(value:unknown)=>typeof value==='string'&&value.length>0?value:null;
  if(data.event==='review_requested')return text(data.bookingId)?`/review/${text(data.bookingId)}`:'/notifications';
  if(['feed_post_likes','feed_post_comments','feed_post_saves'].includes(String(data.event)))return text(data.postId)?`/post/${text(data.postId)}`:'/notifications';
  if(data.event==='review_created')return '/profile';
  // Payments are shown inside the booking they belong to.
  if(text(data.paymentId))return '';
  if(text(data.bookingId))return '/bookings';
  const route=text(data.route);
  if(route?.startsWith('/'))return route;
  const url=text(data.url);
  if(url?.startsWith('/'))return url;
  return notice.url&&notice.url.startsWith('/')?notice.url:'/notifications';
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});
  const secret=Deno.env.get('NOTIFICATION_DISPATCH_SECRET');
  if(!secret||req.headers.get('x-dispatch-secret')!==secret)return new Response('Unauthorized',{status:401,headers:corsHeaders});
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const auth=Deno.env.get('EXPO_ACCESS_TOKEN');
  const expoHeaders:Record<string,string>={'Content-Type':'application/json','Accept':'application/json','Accept-Encoding':'gzip, deflate'};
  if(auth)expoHeaders.Authorization=`Bearer ${auth}`;
  // Web Push is skipped, not failed, when the deployment has no VAPID pair yet.
  const vapid=vapidKeysFromEnv();

  const {data:generated,error:schedulerError}=await db.rpc('run_notification_scheduler');
  if(schedulerError)return Response.json({error:schedulerError.message},{status:500,headers:corsHeaders});

  // Reconcile prior Expo tickets. DeviceNotRegistered permanently disables the exact token.
  const {data:receiptRows}=await db.from('notifications').select('id,expo_ticket_ids').not('expo_ticket_ids','eq','[]').is('delivered_at',null).limit(100);
  const ticketPairs=(receiptRows??[]).flatMap(row=>(row.expo_ticket_ids as Array<{ticketId:string;tokenId:string}>).map(x=>({...x,notificationId:row.id})));
  if(ticketPairs.length){
    const receiptResponse=await fetch(EXPO_RECEIPTS,{method:'POST',headers:expoHeaders,body:JSON.stringify({ids:ticketPairs.map(x=>x.ticketId)})});
    if(receiptResponse.ok){
      const receipts=(await receiptResponse.json()).data??{};
      for(const pair of ticketPairs){
        const receipt=receipts[pair.ticketId]; if(!receipt)continue;
        if(receipt.status==='ok')await db.from('notifications').update({delivered_at:new Date().toISOString()}).eq('id',pair.notificationId);
        if(receipt.details?.error==='DeviceNotRegistered')await db.from('push_tokens').update({enabled:false,updated_at:new Date().toISOString()}).eq('id',pair.tokenId);
      }
    }
  }

  const {data:notices,error:queueError}=await db.from('notifications').select('id,user_id,title,body,url,data,delivery_attempts').is('push_sent_at',null).lte('queued_for',new Date().toISOString()).lt('delivery_attempts',3).order('created_at').limit(100).returns<Notice[]>();
  if(queueError)return Response.json({error:queueError.message},{status:500,headers:corsHeaders});
  let sent=0,failed=0,webDelivered=0;

  for(const notice of notices??[]){
    const {data:tokens}=await db.from('push_tokens').select('id,expo_push_token,web_push_subscription').eq('user_id',notice.user_id).eq('enabled',true).returns<Token[]>();
    if(!tokens?.length)continue;

    const destination=destinationFor(notice);
    const now=new Date().toISOString();
    let webSent=0,webFailed=0,webError='';

    // ---- Web Push (browsers) ----
    const webTokens=tokens.filter((token:Token)=>Boolean(token.web_push_subscription?.endpoint));
    if(vapid&&webTokens.length){
      for(const token of webTokens){
        try{
          const result=await sendWebPush(
            token.web_push_subscription!,
            {
              title:notice.title,
              body:notice.body,
              url:destination||'/notifications',
              notificationId:notice.id,
              data:{...notice.data,url:destination||undefined,notificationId:notice.id},
            },
            vapid,
            { urgency: notice.data?.urgent===true ? 'high' : 'normal' },
          );
          if(result.ok){
            webSent+=1;
            webDelivered+=1;
          }else{
            webFailed+=1;
            webError=`web ${result.status}`;
            // Gone for good: the browser threw the subscription away.
            if(result.expired)await db.from('push_tokens').update({enabled:false,web_push_subscription:null,updated_at:now}).eq('id',token.id);
          }
        }catch(error){
          webFailed+=1;
          webError=error instanceof Error?error.message.slice(0,300):'web push failed';
          // A malformed subscription can't be retried into working.
          if(/VAPID|p256dh|auth|InvalidAccessError/i.test(webError))await db.from('push_tokens').update({enabled:false,updated_at:now}).eq('id',token.id);
        }
      }
    }

    // ---- Expo (the mobile builds) ----
    const expoTokens=tokens.filter((token:Token)=>Boolean(token.expo_push_token));
    const messages=expoTokens.map((token:Token)=>({to:token.expo_push_token,sound:'default',channelId:'sheree-updates',title:notice.title,body:notice.body,data:{...notice.data,url:notice.url,notificationId:notice.id}}));
    let expoOk=false,expoPayload:unknown=null,ticketIds:Array<{ticketId:string;tokenId:string}>=[];

    if(messages.length){
      const response=await fetch(EXPO_SEND,{method:'POST',headers:expoHeaders,body:JSON.stringify(messages)});
      const payload=await response.json().catch(()=>({data:[]}));
      expoPayload=payload;
      const tickets:ExpoTicket[]=Array.isArray(payload.data)?payload.data:[];
      for(let i=0;i<tickets.length;i++){
        const ticket=tickets[i]; const token=expoTokens[i];
        if(ticket.status==='ok'&&ticket.id)ticketIds.push({ticketId:ticket.id,tokenId:token.id});
        if(ticket.details?.error==='DeviceNotRegistered')await db.from('push_tokens').update({enabled:false,updated_at:now}).eq('id',token.id);
      }
      expoOk=response.ok&&ticketIds.length>0;
    }

    if(webSent>0||expoOk){
      // At least one device took the message, so the queue is done with it.
      await db.from('notifications').update({push_sent_at:now,sent_at:now,expo_ticket_ids:ticketIds,delivery_attempts:notice.delivery_attempts+1,last_delivery_attempt_at:now,push_error:webError||null}).eq('id',notice.id);
      sent++;
      continue;
    }

    // Nothing landed. Tokens that can't be used at all are counted as attempts
    // so they fall out of the queue instead of retrying forever.
    const unusable=!vapid&&webTokens.length>0&&expoTokens.length===0;
    await db.from('notifications').update({
      delivery_attempts:notice.delivery_attempts+1,
      last_delivery_attempt_at:now,
      push_error:(webError||JSON.stringify(expoPayload??{}).slice(0,4000)||(unusable?'no push channel configured':'no push tokens')).slice(0,4000),
      queued_for:new Date(Date.now()+15*60_000).toISOString(),
    }).eq('id',notice.id);
    failed++;
  }

  return Response.json({generated:generated??0,sent,failed,webDelivered},{headers:corsHeaders});
});
