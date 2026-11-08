import { requestFoundingBadge } from '@/features/badges/store';
import { cachedQuery, invalidateCachedPrefix } from '@/lib/query-cache';
import { supabase } from '@/lib/supabase/client';
import { storageGet, storageSet } from '@/lib/storage';
import type { FeedComment } from '@/types/database';
import type { FeedPost } from './types';
import { feedSeedFor, fetchFeedPage, mapFeedRows, newFeedSeed, readFeedSeedCookie, type FeedClient, type FeedCursor, type FeedRow } from './rows';

export type PostImage={id:string;imageUrl:string;aspectRatio:number;sortOrder:number};

/** Resolve a share slug while keeping legacy UUID links valid. */
async function resolvePostId(postKey:string):Promise<string>{
  const {data,error}=await (supabase.rpc as any)('resolve_post_id',{post_key:postKey});
  if(!error&&data) return String(data);

  // Keep the client usable during a migration rollout where the RPC may not
  // exist yet, but the slug column is already available.
  const table=supabase.from('feed_posts' as never) as any;
  const {data:slugRow}=await table.select('id').eq('slug',postKey).maybeSingle();
  return slugRow?.id ? String(slugRow.id) : postKey;
}

export async function fetchPostImages(postId:string):Promise<PostImage[]>{
  const resolvedPostId=await resolvePostId(postId);
  const table=supabase.from('feed_post_images' as never) as any;
  const {data,error}=await table.select('id,image_url,aspect_ratio,sort_order').eq('post_id',resolvedPostId).order('sort_order',{ascending:true});
  if(error)throw error;
  return ((data??[]) as Array<{id:string;image_url:string;aspect_ratio:number;sort_order:number}>).map(item=>({
    id:item.id,imageUrl:item.image_url,aspectRatio:Number(item.aspect_ratio),sortOrder:item.sort_order,
  }));
}

export type Cursor={createdAt:string;id:string};
export type { FeedCursor } from './rows';
export type CursorPage<T,C=Cursor>={items:T[];nextCursor:C|null};

// The shuffle seed comes from the cookie the proxy sets, so the server-rendered
// first page and the pages the browser loads next share one order. Without the
// cookie (proxy not configured) it falls back to a seed kept in localStorage.
const legacySeedKey=(userId:string|null)=>`sheree:feed-seed:${userId??'anon'}`;
const feedSeeds=new Map<string,Promise<string>>();
function getFeedSeed(userId:string|null):Promise<string>{
  const cookieSeed=readFeedSeedCookie();
  if(cookieSeed)return Promise.resolve(feedSeedFor(cookieSeed,userId));
  const key=legacySeedKey(userId);
  let pending=feedSeeds.get(key);
  if(!pending){
    pending=(async()=>{
      try{
        let seed=await storageGet(key);
        if(!seed){
          seed=newFeedSeed();
          await storageSet(key,seed);
        }
        return seed;
      }catch{return newFeedSeed()}
    })();
    feedSeeds.set(key,pending);
  }
  return pending;
}

export async function fetchFeed(cursor:FeedCursor|null=null,pageSize=10):Promise<CursorPage<FeedPost,FeedCursor>> {
  const {data:{session}}=await supabase.auth.getSession();
  const seed=await getFeedSeed(session?.user?.id??null);
  const query=()=>fetchFeedPage(supabase as unknown as FeedClient,{seed,cursor,pageSize});
  return !session&&!cursor?cachedQuery(`public-feed:${seed}:${pageSize}`,30_000,query):query();
}

const ENRICHED_POST_SELECT='id,image_url,video_url,video_duration_ms,service_id,caption,price_from,aspect_ratio,rating,rating_count,like_count,comment_count,created_at,professional_profiles!inner(id,display_name,business_name,profile_photo_url,is_verified,is_founding_beautician,is_official,location,business_address),interests!inner(name)';

// The shape this page used before clips and founding badges existed. It is the
// fallback when a deployment's column grants predate those columns, so a post
// still opens instead of failing with 42501.
const BASE_POST_SELECT='id,image_url,caption,price_from,aspect_ratio,rating,rating_count,like_count,comment_count,created_at,professional_profiles!inner(id,display_name,business_name,profile_photo_url,is_verified,location,business_address),interests!inner(name)';

export async function fetchPostById(postId:string):Promise<FeedPost>{
  const resolvedPostId=await resolvePostId(postId);
  const{data:{user}}=await supabase.auth.getUser();
  const table=supabase.from('feed_posts' as never) as any;
  let{data,error}=await table.select(`${ENRICHED_POST_SELECT},slug`).eq('id',resolvedPostId).eq('is_published',true).maybeSingle();
  let degraded=false;
  if(error){
    const fallback=await table.select(`${BASE_POST_SELECT},slug`).eq('id',resolvedPostId).eq('is_published',true).maybeSingle();
    data=fallback.data;
    error=fallback.error;
    degraded=true;
  }
  if(error)throw error;
  if(!data)throw new Error('This story is no longer available.');
  const profile=data.professional_profiles;
  let liked=false,saved=false;
  if(user){
    const[likeRow,saveRow]=await Promise.all([
      supabase.from('feed_post_likes').select('post_id').eq('post_id',resolvedPostId).eq('user_id',user.id).maybeSingle(),
      supabase.from('feed_post_saves').select('post_id').eq('post_id',resolvedPostId).eq('user_id',user.id).maybeSingle(),
    ]);
    liked=Boolean(likeRow.data);saved=Boolean(saveRow.data);
  }
  return{
    id:data.id,slug:data.slug??undefined,professionalId:profile.id,
    professionalName:profile.business_name?.trim()||profile.display_name||profile.business_name,
    avatarUrl:profile.profile_photo_url,imageUrl:data.image_url,
    videoUrl:data.video_url??null,
    videoDurationMs:data.video_duration_ms==null?null:Number(data.video_duration_ms),
    caption:data.caption??'',
    category:data.interests?.name??'Beauty',location:profile.location??profile.business_address??'Accra',
    priceFrom:data.price_from,serviceId:data.service_id??null,
    rating:Number(data.rating??0),ratingCount:data.rating_count??0,
    verified:Boolean(profile.is_verified),
    // The degraded query cannot see the status columns; resolve founding via
    // the badge RPC (public, cached) and leave official false.
    founding:degraded
      ?Boolean((await requestFoundingBadge(profile.id).catch(()=>null))?.isFounding)
      :Boolean(profile.is_founding_beautician),
    official:degraded?false:Boolean(profile.is_official),
    likeCount:data.like_count??0,commentCount:data.comment_count??0,
    liked,saved,aspectRatio:Number(data.aspect_ratio??0.82),createdAt:data.created_at,
  };
}

export async function fetchSavedFeed(cursor:Cursor|null=null,pageSize=20):Promise<CursorPage<FeedPost>> {
  const {data,error}=await (supabase.rpc as any)('get_saved_feed_page',{cursor_created_at:cursor?.createdAt??null,cursor_post_id:cursor?.id??null,page_size:pageSize});
  if(error) throw error;
  const rows=(data??[]) as Array<FeedRow&{saved_at:string}>,last=rows.at(-1);
  return{items:await mapFeedRows(supabase as unknown as FeedClient,rows),nextCursor:rows.length===pageSize&&last?{createdAt:last.saved_at,id:last.id}:null};
}

export async function setFeedReaction(postId:string,kind:'like'|'save',active:boolean){
  const table=kind==='like'?'feed_post_likes':'feed_post_saves';
  const {data:{user}}=await supabase.auth.getUser();
  if(!user) throw new Error('Sign in to like or save posts.');
  const query=supabase.from(table);
  const result=active
    ? await query.upsert({post_id:postId,user_id:user.id} as never)
    : await query.delete().eq('post_id',postId).eq('user_id',user.id);
  if(result.error) throw result.error;
}

export async function reportPost(postId:string,reason:string){
  const{data:{user}}=await supabase.auth.getUser();
  if(!user)throw new Error('Sign in to report a post.');
  const table=supabase.from('content_reports' as never) as any;
  const{error}=await table.insert({post_id:postId,reporter_id:user.id,reason});
  if(error)throw error;
}

/** Drops cached feed pages so the next visit reflects a new post. */
export function invalidateFeedQueries(){
  invalidateCachedPrefix('public-feed:');
  invalidateCachedPrefix('creator:');
}

export async function fetchPostComments(postId:string,cursor:Cursor|null=null,pageSize=30):Promise<CursorPage<FeedComment>>{
  const resolvedPostId=await resolvePostId(postId);
  const {data,error}=await (supabase.rpc as any)('get_post_comments_page',{post_id_value:resolvedPostId,cursor_created_at:cursor?.createdAt??null,cursor_id:cursor?.id??null,page_size:pageSize});
  if(error)throw error;
  const rows=(data??[]) as Array<{id:string;post_id:string;user_id:string;parent_id:string|null;body:string;created_at:string;author_name:string;avatar_url:string|null;reply_count:number}>;
  const last=rows.at(-1);
  return{items:rows.map(row=>({id:row.id,postId:row.post_id,userId:row.user_id,parentId:row.parent_id??null,body:row.body,createdAt:row.created_at,authorName:row.author_name,avatarUrl:row.avatar_url,replyCount:Number(row.reply_count??0),replyToName:null})).reverse(),nextCursor:rows.length===pageSize&&last?{createdAt:last.created_at,id:last.id}:null};
}
export async function fetchCommentReplies(commentId:string,cursor:Cursor|null=null,pageSize=30):Promise<CursorPage<FeedComment>>{
  const {data,error}=await (supabase.rpc as any)('get_comment_replies_page',{comment_id_value:commentId,cursor_created_at:cursor?.createdAt??null,cursor_id:cursor?.id??null,page_size:pageSize});
  if(error)throw error;
  const rows=(data??[]) as Array<{id:string;post_id:string;user_id:string;parent_id:string|null;body:string;created_at:string;author_name:string;avatar_url:string|null;reply_count:number;reply_to_name:string|null}>;
  const last=rows.at(-1);
  return{items:rows.map(row=>({id:row.id,postId:row.post_id,userId:row.user_id,parentId:row.parent_id??null,body:row.body,createdAt:row.created_at,authorName:row.author_name,avatarUrl:row.avatar_url,replyCount:Number(row.reply_count??0),replyToName:row.reply_to_name??null})).reverse(),nextCursor:rows.length===pageSize&&last?{createdAt:last.created_at,id:last.id}:null};
}
export async function createPostComment(postId:string,body:string,parentId:string|null=null):Promise<FeedComment>{const{data:{user}}=await supabase.auth.getUser();if(!user)throw new Error('Sign in to comment.');const table=supabase.from('feed_post_comments' as never) as any;const{data,error}=await table.insert({post_id:postId,user_id:user.id,body:body.trim(),parent_id:parentId}).select('id,post_id,user_id,parent_id,body,created_at').single();if(error)throw error;const{data:author}=await supabase.from('users').select('username,avatar_url').eq('id',user.id).maybeSingle();return{id:data.id,postId:data.post_id,userId:data.user_id,parentId:data.parent_id??null,body:data.body,createdAt:data.created_at,authorName:author?.username??'Sheree member',avatarUrl:author?.avatar_url??null,replyCount:0,replyToName:null}}
