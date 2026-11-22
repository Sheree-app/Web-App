import { api, type Page } from '@/lib/api';
import { cachedQuery, invalidateCachedPrefix } from '@/lib/query-cache';
import { storageGet, storageSet } from '@/lib/storage';
import type { FeedComment } from '@/types/database';
import type { FeedPost } from './types';
import { fetchFeedPage, newFeedSeed, readFeedSeedCookie, toFeedPost, type FeedCursor, type FeedRow } from './rows';

/**
 * Feed reads and reactions from the Sheree API (`sheree-backend/docs/api/feed.md`).
 * Every route that takes a post key accepts a share slug or a UUID, so slugs no
 * longer need resolving here. Cursors are opaque strings from the API.
 */
type PostRow = FeedRow & {
  slug: string | null;
  images: Array<{ id: string; image_url: string; aspect_ratio: number; sort_order: number }>;
};
type CommentRow = {
  id: string;
  post_id: string;
  user_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  author_name: string;
  avatar_url: string | null;
  reply_count: number;
  reply_to_name: string | null;
};

export type PostImage={id:string;imageUrl:string;aspectRatio:number;sortOrder:number};
/** Opaque, from the API: pass `nextCursor` back as it came. */
export type Cursor=string;
export type { FeedCursor } from './rows';
export type CursorPage<T,C=Cursor>={items:T[];nextCursor:C|null};

const toComment=(row:CommentRow):FeedComment=>({id:row.id,postId:row.post_id,userId:row.user_id,parentId:row.parent_id??null,body:row.body,createdAt:row.created_at,authorName:row.author_name,avatarUrl:row.avatar_url,replyCount:Number(row.reply_count??0),replyToName:row.reply_to_name??null});

// The shuffle seed comes from the cookie the proxy sets, so the server-rendered
// first page and the pages the browser loads next share one order. Without the
// cookie (proxy not configured) it falls back to a seed kept in localStorage.
const legacySeedKey='sheree:feed-seed:browser';
let legacySeed:Promise<string>|null=null;
function getFeedSeed():Promise<string>{
  const cookieSeed=readFeedSeedCookie();
  if(cookieSeed)return Promise.resolve(cookieSeed);
  legacySeed??=(async()=>{
    try{
      let seed=await storageGet(legacySeedKey);
      if(!seed){
        seed=newFeedSeed();
        await storageSet(legacySeedKey,seed);
      }
      return seed;
    }catch{return newFeedSeed()}
  })();
  return legacySeed;
}

export async function fetchFeed(cursor:FeedCursor|null=null,pageSize=10):Promise<CursorPage<FeedPost,FeedCursor>> {
  const [user,seed]=await Promise.all([api.session.ready(),getFeedSeed()]);
  const query=()=>fetchFeedPage({seed,cursor,pageSize});
  // Guests' first page is the same for everyone with this seed: cache it briefly.
  return !user&&!cursor?cachedQuery(`public-feed:${seed}:${pageSize}`,30_000,query):query();
}

/**
 * One post with its pictures. The post page asks for the post and for its
 * pictures separately; both come from one request, shared for a few seconds.
 */
const POST_TTL_MS=5_000;
const postRequests=new Map<string,{at:number;request:Promise<PostRow>}>();
function loadPost(postKey:string):Promise<PostRow>{
  const held=postRequests.get(postKey);
  if(held&&Date.now()-held.at<POST_TTL_MS)return held.request;
  const request=api.get<PostRow>(`/v1/posts/${encodeURIComponent(postKey)}`,{auth:'optional'});
  postRequests.set(postKey,{at:Date.now(),request});
  request.catch(()=>postRequests.delete(postKey));
  return request;
}

export async function fetchPostImages(postId:string):Promise<PostImage[]>{
  const row=await loadPost(postId);
  return row.images.map(item=>({id:item.id,imageUrl:item.image_url,aspectRatio:Number(item.aspect_ratio),sortOrder:item.sort_order}));
}

/** `postId` is the route param: a slug for shared links, a UUID in-app. */
export async function fetchPostById(postId:string):Promise<FeedPost>{
  const row=await loadPost(postId);
  return{...toFeedPost(row),slug:row.slug??undefined};
}

export async function fetchSavedFeed(cursor:Cursor|null=null,pageSize=20):Promise<CursorPage<FeedPost>> {
  const page=await api.get<Page<FeedRow&{saved_at:string}>>('/v1/feed/saved',{query:{cursor:cursor??undefined,page_size:Math.min(50,pageSize)}});
  return{items:page.items.map(toFeedPost),nextCursor:page.next_cursor};
}

export async function setFeedReaction(postId:string,kind:'like'|'save',active:boolean){
  const path=`/v1/posts/${encodeURIComponent(postId)}/${kind}`;
  if(active)await api.put<void>(path);
  else await api.delete<void>(path);
  postRequests.clear();
}

export async function reportPost(postId:string,reason:string){
  await api.post<void>(`/v1/posts/${encodeURIComponent(postId)}/reports`,{body:{reason}});
}

/** Drops cached feed pages so the next visit reflects a new post. */
export function invalidateFeedQueries(){
  invalidateCachedPrefix('public-feed:');
  invalidateCachedPrefix('creator:');
}

// Pages come newest first; each page is reversed so the thread reads top to bottom.
export async function fetchPostComments(postId:string,cursor:Cursor|null=null,pageSize=30):Promise<CursorPage<FeedComment>>{
  const page=await api.get<Page<CommentRow>>(`/v1/posts/${encodeURIComponent(postId)}/comments`,{auth:'optional',query:{cursor:cursor??undefined,page_size:Math.min(50,pageSize)}});
  return{items:page.items.map(toComment).reverse(),nextCursor:page.next_cursor};
}
export async function fetchCommentReplies(commentId:string,cursor:Cursor|null=null,pageSize=30):Promise<CursorPage<FeedComment>>{
  const page=await api.get<Page<CommentRow>>(`/v1/comments/${encodeURIComponent(commentId)}/replies`,{auth:'optional',query:{cursor:cursor??undefined,page_size:Math.min(50,pageSize)}});
  return{items:page.items.map(toComment).reverse(),nextCursor:page.next_cursor};
}
export async function createPostComment(postId:string,body:string,parentId:string|null=null):Promise<FeedComment>{
  const row=await api.post<CommentRow>(`/v1/posts/${encodeURIComponent(postId)}/comments`,{body:{body:body.trim(),...(parentId?{parent_id:parentId}:{})}});
  postRequests.clear();
  return toComment(row);
}
