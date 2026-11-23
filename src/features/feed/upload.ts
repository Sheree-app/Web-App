import {
  deleteMedia,
  uploadMedia,
  type UploadedMedia,
  type UploadedVideo,
} from '@/lib/media';
import {
  MAX_VIDEO_BYTES,
  posterAsset,
  prepareVideo,
  resolveVideoMime,
  uploadVideo,
  VideoValidationError,
  VIDEO_MESSAGES,
} from '@/lib/media/video';
import { fetchAccount } from '@/features/auth/api';
import { fetchExploreCategories } from '@/features/explore/api';
import { api, type Page } from '@/lib/api';
import { AppError, errorCode } from '@/lib/errors';
import { invalidateCached, invalidateCachedPrefix } from '@/lib/query-cache';
import { invalidateFeedQueries } from './api';

/**
 * Posting and the portfolio through the Sheree API (`sheree-backend/docs/api/feed.md`,
 * `profiles.md`). Uploads go straight to storage (`@/lib/media`); the API then
 * builds the post or studio photo from the upload ids and cleans the uploads up
 * when a post or photo is deleted.
 */

export type PostCategory={id:string;name:string};

/** Cache keys (`useQuery`); the cache is per signed-in pro. */
export const OWN_POSTS_KEY='me:posts';
export const STUDIO_PHOTOS_KEY='me:studio-photos';
export const POST_CATEGORIES_KEY='pub:post-categories';

/** After a post changes: her own list, the feeds and every public profile view. */
function invalidatePostQueries(){
  invalidateFeedQueries();
  invalidateCached(OWN_POSTS_KEY);
  invalidateCachedPrefix('pub:');
}

/** After a studio photo changes: her own grid and every public profile view. */
function invalidateStudioPhotoQueries(){
  invalidateCached(STUDIO_PHOTOS_KEY);
  invalidateCachedPrefix('pub:');
}
export type ProfessionalPost={id:string;imageUrl:string;videoUrl:string|null;caption:string;createdAt:string};
export type StudioPhoto={id:string;imageUrl:string;aspectRatio:number;createdAt:string};

/** Product bounds shared with mobile. */
const MIN_ASPECT_RATIO=0.4;
const MAX_ASPECT_RATIO=2;
const MAX_POST_IMAGES=8;

export type PublishStage = 'preparing-video'|'poster'|'image'|'video'|'saving';

export async function getPostCategories():Promise<PostCategory[]> {
  // Active categories, A to Z for the picker.
  return(await fetchExploreCategories()).map(({id,name})=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name));
}

type UploadAsset={uri:string;mimeType?:string|null;fileName?:string|null;width:number;height:number;file?:Blob};

export type PublishPostInput={
  /** Pictures for a picture post (1–8). */
  assets?:UploadAsset[];
  /** A single clip. A post never contains both pictures and a clip. */
  video?:File|null;
  caption:string;
  interestId:string;
  priceFrom:number|null;
  serviceId?:string|null;
};

/** Clamps an aspect ratio to the same bounds the mobile app stores. */
export function clampFeedAspectRatio(value:number,fallback=0.82):number{
  if(!Number.isFinite(value)||value<=0) return fallback;
  return Math.min(MAX_ASPECT_RATIO,Math.max(MIN_ASPECT_RATIO,value));
}

/**
 * "Complete enough to publish": a professional profile with a name and finished
 * onboarding. The API only requires the profile, so the rest is checked here.
 */
async function ensureCanPublish(){
  const account=await fetchAccount();
  const profile=account.professional;
  if(!profile||!profile.business_name?.trim()||!account.onboarding_completed){
    throw new AppError('Finish your business profile before posting.');
  }
}

const notAProfessional=(error:unknown,message='Your business profile could not be found.')=>
  errorCode(error)==='not_a_professional'?new AppError(message):error;

/** Best-effort removal of a clip that never became part of a post. */
async function cleanupVideoClip(video:UploadedVideo|null){
  if(!video) return;
  await deleteMedia({provider:'cloudinary',publicId:video.publicId}).catch(()=>undefined);
}

/** Best-effort removal of an uploaded poster image. */
async function cleanupPoster(poster:UploadedMedia|null){
  if(!poster) return;
  await deleteMedia(poster).catch(()=>undefined);
}

/**
 * Publishes a picture post or a single-clip post.
 *
 * Clip flow, mirroring mobile's `publishFeedPost`:
 *   1. validate + measure the clip and capture its poster locally
 *   2. upload the poster through the ordinary image pipeline
 *   3. request a signed Cloudinary ticket
 *   4. POST the clip straight to Cloudinary
 *   5. confirm with `/v1/media`
 *   6. `POST /v1/posts` with the clip and poster upload ids
 *
 * Every failure rolls back what was already uploaded. Cleanup is best-effort
 * but never replaces the original error.
 */
export async function publishFeedPost(
  input:PublishPostInput,
  onProgress?:(completed:number,stage?:PublishStage)=>void,
){
  const assets=input.assets??[];
  const videoFile=input.video??null;

  if(videoFile&&assets.length){
    throw new VideoValidationError('Choose either pictures or one clip, not both.');
  }
  if(!videoFile){
    if(assets.length<1||assets.length>MAX_POST_IMAGES) throw new Error('Choose between 1 and 8 pictures.');
  }
  if(!input.caption.trim()) throw new Error('Add a caption so clients know what they are seeing.');
  if(!input.interestId) throw new Error('Choose a category for this post.');

  if(videoFile){
    // Fail fast, before any network work, when the container is unsupported or
    // the file is far too large.
    if(!resolveVideoMime(videoFile)) throw new VideoValidationError(VIDEO_MESSAGES.unsupported);
    if(videoFile.size>MAX_VIDEO_BYTES) throw new VideoValidationError(VIDEO_MESSAGES.tooLarge);
  }

  await ensureCanPublish();
  const caption=input.caption.trim();

  if(videoFile) return publishVideoPost({...input,assets:[],video:videoFile,caption},onProgress);

  const uploaded:Array<{media:UploadedMedia;width:number;height:number}>=[];
  try{
    for(const [index,asset] of assets.entries()){
      // Feed cards render the 720px feed variant; no full-res originals are
      // shipped to the feed.
      const media=await uploadMedia('post',asset,{});
      uploaded.push({media,width:asset.width,height:asset.height});
      onProgress?.(index+1,'image');
    }
    // The server builds the post from the upload ids: the cover (first
    // picture), its aspect ratio (clamped to .4–2) and the picture list.
    await api.post('/v1/posts',{body:{
      caption,
      interest_id:input.interestId,
      price_from:input.priceFrom,
      service_id:input.serviceId??null,
      image_media_ids:uploaded.map(item=>item.media.mediaId),
    }});

    invalidatePostQueries();
  }catch(error){
    await Promise.allSettled(uploaded.map(item=>deleteMedia(item.media).catch(()=>undefined)));
    throw notAProfessional(error,'Finish your business profile before posting.');
  }
}

async function publishVideoPost(
  input:PublishPostInput&{video:File},
  onProgress?:(completed:number,stage?:PublishStage)=>void,
){
  onProgress?.(0,'preparing-video');

  // 1. Validate the real duration and capture the poster — nothing uploaded yet.
  const prepared=await prepareVideo(input.video);

  let poster:UploadedMedia|null=null;
  let video:UploadedVideo|null=null;

  try{
    // 2. The poster is a normal post image and must exist before the row.
    onProgress?.(0,'poster');
    poster=await uploadMedia('post',posterAsset(prepared.poster,'poster.webp'),{});
    onProgress?.(1,'video');

    // 3–5. Signed ticket → direct Cloudinary upload → confirmation.
    video=await uploadVideo(prepared.file,prepared.clip,{purpose:'post'});

    // 6. Persist the post. The server sets the cover's aspect ratio.
    onProgress?.(1,'saving');
    if(!poster.mediaId||!video.mediaId) throw new AppError('The upload could not be saved. Please try again.');
    await api.post('/v1/posts',{body:{
      caption:input.caption.trim(),
      interest_id:input.interestId,
      price_from:input.priceFrom,
      service_id:input.serviceId??null,
      video:{clip_media_id:video.mediaId,poster_media_id:poster.mediaId},
    }});

    invalidatePostQueries();
  }catch(error){
    // Roll back in reverse order, then surface the original failure.
    await Promise.allSettled([
      cleanupVideoClip(video),
      cleanupPoster(poster),
    ]);
    throw notAProfessional(error,'Finish your business profile before posting.');
  }
}

type OwnPostRow={id:string;image_url:string;caption:string|null;created_at:string;video_url:string|null};
const OWN_POSTS_PAGE_SIZE=100;
const OWN_POSTS_MAX_PAGES=20;

/** Every post of the signed-in professional, newest first. */
export async function getProfessionalPosts():Promise<ProfessionalPost[]>{
  const rows:OwnPostRow[]=[];
  let cursor:string|null=null;
  try{
    // The portfolio shows everything at once, so walk the pages (bounded).
    for(let page=0;page<OWN_POSTS_MAX_PAGES;page+=1){
      const result:Page<OwnPostRow>=await api.get<Page<OwnPostRow>>('/v1/me/posts',{query:{cursor:cursor??undefined,page_size:OWN_POSTS_PAGE_SIZE}});
      rows.push(...result.items);
      cursor=result.next_cursor;
      if(!cursor) break;
    }
  }catch(error){throw notAProfessional(error)}
  return rows.map(post=>({
    id:post.id,
    imageUrl:post.image_url,
    videoUrl:post.video_url??null,
    caption:post.caption??'',
    createdAt:post.created_at,
  }));
}

/** The server deletes the post, then (best effort) its pictures and clip. */
export async function deleteProfessionalPost(post:ProfessionalPost){
  try{await api.delete<void>(`/v1/posts/${encodeURIComponent(post.id)}`)}catch(error){throw notAProfessional(error)}
  invalidatePostQueries();
}

type StudioPhotoRow={id:string;image_url:string;aspect_ratio:number|string;created_at:string};
const toStudioPhoto=(row:StudioPhotoRow):StudioPhoto=>({id:row.id,imageUrl:row.image_url,aspectRatio:Number(row.aspect_ratio),createdAt:row.created_at});

export async function getStudioPhotos():Promise<StudioPhoto[]>{
  try{return(await api.get<StudioPhotoRow[]>('/v1/me/studio-photos')).map(toStudioPhoto)}catch(error){throw notAProfessional(error)}
}

export async function addStudioPhoto(asset:UploadAsset){
  const media=await uploadMedia('portfolio',asset);
  try{
    const photo=toStudioPhoto(await api.post<StudioPhotoRow>('/v1/me/studio-photos',{body:{media_id:media.mediaId}}));
    invalidateStudioPhotoQueries();
    return photo;
  }catch(error){
    await deleteMedia(media).catch(()=>undefined);
    throw notAProfessional(error);
  }
}

/** The server deletes the photo, then (best effort) its upload. */
export async function deleteStudioPhoto(photo:StudioPhoto){
  try{await api.delete<void>(`/v1/me/studio-photos/${encodeURIComponent(photo.id)}`)}catch(error){throw notAProfessional(error)}
  invalidateStudioPhotoQueries();
}
