import { requestFoundingBadge } from '@/features/badges/store';
import { cachedQuery, invalidateCachedPrefix } from '@/lib/query-cache';
import { supabase } from '@/lib/supabase/client';
import { storageGet, storageSet } from '@/lib/storage';
import type { FeedComment } from '@/types/database';
import type { FeedPost } from './types';

type FeedRow = {
  id:string; professional_id:string; professional_name:string; avatar_url:string|null;
  image_url:string; caption:string|null; category:string; location:string|null;
  price_from:number|null; rating:number|null; rating_count:number|null; is_verified:boolean;
  like_count:number; comment_count:number; is_liked:boolean; is_saved:boolean;
  aspect_ratio:number|null; created_at:string;
};

/** Columns the feed RPCs do not return, fetched once per page. */
type PostMetaRow = {
  id:string;
  video_url:string|null;
  video_duration_ms:number|null;
  service_id:string|null;
};

type ProfileMetaRow = {
  id:string;
  business_name:string|null;
  is_founding_beautician:boolean|null;
  is_official:boolean|null;
};

export type PostImage={id:string;imageUrl:string;aspectRatio:number;sortOrder:number};

export async function fetchPostImages(postId:string):Promise<PostImage[]>{
  const table=supabase.from('feed_post_images' as never) as any;
  const {data,error}=await table.select('id,image_url,aspect_ratio,sort_order').eq('post_id',postId).order('sort_order',{ascending:true});
  if(error)throw error;
  return ((data??[]) as Array<{id:string;image_url:string;aspect_ratio:number;sort_order:number}>).map(item=>({
    id:item.id,imageUrl:item.image_url,aspectRatio:Number(item.aspect_ratio),sortOrder:item.sort_order,
  }));
}

export type Cursor={createdAt:string;id:string};
export type FeedCursor={id:string};
export type CursorPage<T,C=Cursor>={items:T[];nextCursor:C|null};

async function optionalRows<T>(query:PromiseLike<{data:unknown;error:unknown}>):Promise<T[]>{
  try{
    const {data,error}=await query;
    if(error)throw error;
    return (data??[]) as T[];
  }catch{
    // The feed is still readable without the enrichment columns.
    return [];
  }
}

/**
 * Maps feed RPC rows into the client model.
 *
 * The feed RPCs predate clips, so video metadata and the founding/official
 * flags are read in two batched lookups per page — never once per card.
 */
async function mapFeedRows(rows:FeedRow[]):Promise<FeedPost[]>{
  if(!rows.length) return [];

  const postIds=[...new Set(rows.map(row=>row.id))];
  const profileIds=[...new Set(rows.map(row=>row.professional_id))];
  const postTable=supabase.from('feed_posts' as never) as any;
  const profileTable=supabase.from('professional_profiles' as never) as any;

  const [postMeta,profileMeta]=await Promise.all([
    optionalRows<PostMetaRow>(postTable.select('id,video_url,video_duration_ms,service_id').in('id',postIds)),
    optionalRows<ProfileMetaRow>(profileTable.select('id,business_name,is_founding_beautician,is_official').in('id',profileIds)),
  ]);

  const posts=new Map(postMeta.map(row=>[row.id,row]));
  const profiles=new Map(profileMeta.map(row=>[row.id,row]));

  return rows.map(row=>{
    const meta=posts.get(row.id);
    const profile=profiles.get(row.professional_id);
    const businessName=profile?.business_name?.trim();
    return {
      id:row.id,
      professionalId:row.professional_id,
      // Mobile shows the business name as the public professional name.
      professionalName:businessName||row.professional_name,
      avatarUrl:row.avatar_url,
      imageUrl:row.image_url,
      videoUrl:meta?.video_url??null,
      videoDurationMs:meta?.video_duration_ms==null?null:Number(meta.video_duration_ms),
      caption:row.caption??'',
      category:row.category,
      location:row.location??'Accra',
      priceFrom:row.price_from,
      serviceId:meta?.service_id??null,
      rating:Number(row.rating??0),
      ratingCount:row.rating_count??0,
      verified:Boolean(row.is_verified),
      founding:Boolean(profile?.is_founding_beautician),
      official:Boolean(profile?.is_official),
      likeCount:row.like_count,
      commentCount:row.comment_count,
      liked:row.is_liked,
      saved:row.is_saved,
      aspectRatio:Number(row.aspect_ratio??0.82),
      createdAt:row.created_at,
    };
  });
}

// A per-user seed (persisted on-device) keeps one person's randomized feed
// stable across refreshes and pagination, while differing between people.
const feedSeedKey=(userId:string|null)=>`sheree:feed-seed:${userId??'anon'}`;
const feedSeeds=new Map<string,Promise<string>>();
function getFeedSeed(userId:string|null):Promise<string>{
  const key=feedSeedKey(userId);
  let pending=feedSeeds.get(key);
  if(!pending){
    pending=(async()=>{
      try{
        let seed=await storageGet(key);
        if(!seed){
          seed=`${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
          await storageSet(key,seed);
        }
        return seed;
      }catch{return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`}
    })();
    feedSeeds.set(key,pending);
  }
  return pending;
}

export async function fetchFeed(cursor:FeedCursor|null=null,pageSize=10):Promise<CursorPage<FeedPost,FeedCursor>> {
  const {data:{session}}=await supabase.auth.getSession();
  const seed=await getFeedSeed(session?.user?.id??null);
  const query=async()=>{
    const {data,error}=await (supabase.rpc as any)('get_made_for_you_feed',{
      cursor_id:cursor?.id??null,page_size:pageSize,feed_seed:seed,
    });
    if(error){
      // Keep deployed clients working while the migration rolls out: if the
      // randomized RPC is missing, fall back to the deterministic feed.
      if(!cursor&&(/get_made_for_you_feed/i.test(error.message??'')||error.code==='PGRST202')){
        const page=await (supabase.rpc as any)('get_feed_page',{cursor_created_at:null,cursor_id:null,page_size:pageSize});
        if(!page.error)return{items:await mapFeedRows((page.data??[]) as FeedRow[]),nextCursor:null};
        const legacy=await supabase.rpc('get_personalized_feed',{page_number:0,page_size:pageSize});
        if(legacy.error)throw legacy.error;
        return{items:await mapFeedRows((legacy.data??[]) as FeedRow[]),nextCursor:null};
      }
      throw error;
    }
    const rows=(data??[]) as FeedRow[],last=rows.at(-1);
    return{items:await mapFeedRows(rows),nextCursor:rows.length===pageSize&&last?{id:last.id}:null};
  };
  return !session&&!cursor?cachedQuery(`public-feed:${seed}:${pageSize}`,30_000,query):query();
}

const ENRICHED_POST_SELECT='id,image_url,video_url,video_duration_ms,service_id,caption,price_from,aspect_ratio,rating,rating_count,like_count,comment_count,created_at,professional_profiles!inner(id,display_name,business_name,profile_photo_url,is_verified,is_founding_beautician,is_official,location,business_address),interests!inner(name)';

// The shape this page used before clips and founding badges existed. It is the
// fallback when a deployment's column grants predate those columns, so a post
// still opens instead of failing with 42501.
const BASE_POST_SELECT='id,image_url,caption,price_from,aspect_ratio,rating,rating_count,like_count,comment_count,created_at,professional_profiles!inner(id,display_name,business_name,profile_photo_url,is_verified,location,business_address),interests!inner(name)';

export async function fetchPostById(postId:string):Promise<FeedPost>{
  const{data:{user}}=await supabase.auth.getUser();
  const table=supabase.from('feed_posts' as never) as any;
  let{data,error}=await table.select(ENRICHED_POST_SELECT).eq('id',postId).eq('is_published',true).maybeSingle();
  let degraded=false;
  if(error){
    const fallback=await table.select(BASE_POST_SELECT).eq('id',postId).eq('is_published',true).maybeSingle();
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
      supabase.from('feed_post_likes').select('post_id').eq('post_id',postId).eq('user_id',user.id).maybeSingle(),
      supabase.from('feed_post_saves').select('post_id').eq('post_id',postId).eq('user_id',user.id).maybeSingle(),
    ]);
    liked=Boolean(likeRow.data);saved=Boolean(saveRow.data);
  }
  return{
    id:data.id,professionalId:profile.id,
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
  return{items:await mapFeedRows(rows),nextCursor:rows.length===pageSize&&last?{createdAt:last.saved_at,id:last.id}:null};
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
  const {data,error}=await (supabase.rpc as any)('get_post_comments_page',{post_id_value:postId,cursor_created_at:cursor?.createdAt??null,cursor_id:cursor?.id??null,page_size:pageSize});
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
