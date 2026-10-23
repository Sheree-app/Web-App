import {
  deleteMedia,
  feedUrl,
  uploadMedia,
  type UploadedMedia,
  type UploadedVideo,
} from '@/lib/media';
import { identifyMedia } from '@/lib/media/urls';
import {
  MAX_VIDEO_BYTES,
  posterAsset,
  prepareVideo,
  resolveVideoMime,
  uploadVideo,
  VideoValidationError,
  VIDEO_MESSAGES,
} from '@/lib/media/video';
import { supabase } from '@/lib/supabase';
import { invalidateFeedQueries } from './api';

export type PostCategory={id:string;name:string};
export type ProfessionalPost={id:string;imageUrl:string;videoUrl:string|null;caption:string;createdAt:string};
export type StudioPhoto={id:string;imageUrl:string;aspectRatio:number;createdAt:string};

/** Product bounds shared with mobile. */
const MIN_ASPECT_RATIO=0.4;
const MAX_ASPECT_RATIO=2;
const MAX_POST_IMAGES=8;

export type PublishStage = 'preparing-video'|'poster'|'image'|'video'|'saving';

export async function getPostCategories():Promise<PostCategory[]> {
  const {data,error}=await supabase.from('interests').select('id,name').order('name');
  if(error) throw error;
  return data??[];
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

function aspectOf(width:number,height:number):number{
  if(!width||!height) return 0.82;
  return clampFeedAspectRatio(width/height);
}

type OwnedProfileRow={
  id:string;
  business_name?:string|null;
  onboarding_completed_at?:string|null;
  deleted_at?:string|null;
};

async function resolveProfessionalProfile(){
  const {data:{user}}=await supabase.auth.getUser();
  if(!user) throw new Error('Sign in again to publish your work.');

  const full=await supabase
    .from('professional_profiles')
    .select('id,business_name,onboarding_completed_at,deleted_at' as never)
    .eq('user_id',user.id)
    .single();

  let profile=full.data as unknown as OwnedProfileRow|null;
  let completenessVerified=true;

  if(full.error||!profile){
    // Older deployments may not grant SELECT on the onboarding columns yet.
    // Fall back to the ownership check (the Edge Function still requires a
    // professional profile) rather than blocking publishing on a grant.
    const minimal=await supabase
      .from('professional_profiles')
      .select('id,business_name' as never)
      .eq('user_id',user.id)
      .single();
    if(minimal.error||!minimal.data){
      throw new Error('Finish your business profile before posting.');
    }
    profile=minimal.data as unknown as OwnedProfileRow;
    completenessVerified=false;
  }

  // "Complete enough to publish": a live business profile with a name.
  if(profile.deleted_at) throw new Error('Finish your business profile before posting.');
  if(
    completenessVerified &&
    (!profile.business_name?.trim()||!profile.onboarding_completed_at)
  ){
    throw new Error('Finish your business profile before posting.');
  }
  return profile;
}

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
 *   5. confirm with `media-storage`
 *   6. insert `feed_posts` (no `feed_post_images` row for clips)
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

  const profile=await resolveProfessionalProfile();
  const caption=input.caption.trim();

  if(videoFile) return publishVideoPost({...input,assets:[],video:videoFile,caption},profile,onProgress);

  const uploaded:Array<{media:UploadedMedia;width:number;height:number}>=[];
  try{
    for(const [index,asset] of assets.entries()){
      // Feed cards render the 720px feed variant; no full-res originals are
      // shipped to the feed.
      const media=await uploadMedia('post',asset,{});
      uploaded.push({media,width:asset.width,height:asset.height});
      onProgress?.(index+1,'image');
    }
    const cover=uploaded[0];
    const {data:post,error:postError}=await supabase.from('feed_posts').insert({
      professional_id:profile.id,
      interest_id:input.interestId,
      image_url:feedUrl(cover.media),
      caption,
      price_from:input.priceFrom,
      service_id:input.serviceId??null,
      aspect_ratio:aspectOf(cover.width,cover.height),
    } as never).select('id').single();
    if(postError)throw postError;

    const {error:imageError}=await (supabase.from('feed_post_images' as never) as any).insert(uploaded.map((item,index)=>({
      post_id:post.id,
      image_url:feedUrl(item.media),
      aspect_ratio:aspectOf(item.width,item.height),
      sort_order:index,
    })));
    if(imageError){
      // The post exists without its attachments: remove it before surfacing.
      await supabase.from('feed_posts').delete().eq('id',post.id);
      throw imageError;
    }

    invalidateFeedQueries();
  }catch(error){
    await Promise.allSettled(uploaded.map(item=>deleteMedia(item.media).catch(()=>undefined)));
    throw error;
  }
}

async function publishVideoPost(
  input:PublishPostInput&{video:File},
  profile:{id:string},
  onProgress?:(completed:number,stage?:PublishStage)=>void,
){
  onProgress?.(0,'preparing-video');

  // 1. Validate the real duration and capture the poster — nothing uploaded yet.
  const prepared=await prepareVideo(input.video);
  const aspectRatio=clampFeedAspectRatio(prepared.clip.width/prepared.clip.height);

  let poster:UploadedMedia|null=null;
  let video:UploadedVideo|null=null;

  try{
    // 2. The poster is a normal post image and must exist before the row.
    onProgress?.(0,'poster');
    poster=await uploadMedia('post',posterAsset(prepared.poster,'poster.webp'),{});
    onProgress?.(1,'video');

    // 3–5. Signed ticket → direct Cloudinary upload → confirmation.
    video=await uploadVideo(prepared.file,prepared.clip,{purpose:'post'});

    // 6. Persist the post. Clips never get `feed_post_images` rows.
    onProgress?.(1,'saving');
    const {error:postError}=await supabase.from('feed_posts').insert({
      professional_id:profile.id,
      interest_id:input.interestId,
      image_url:feedUrl(poster),
      caption:input.caption.trim(),
      price_from:input.priceFrom,
      service_id:input.serviceId??null,
      aspect_ratio:aspectRatio,
      video_url:video.url,
      video_duration_ms:video.durationMs,
    } as never).select('id').single();
    if(postError)throw postError;

    invalidateFeedQueries();
  }catch(error){
    // Roll back in reverse order, then surface the original failure.
    await Promise.allSettled([
      cleanupVideoClip(video),
      cleanupPoster(poster),
    ]);
    throw error;
  }
}

async function getOwnProfessionalId(){
  const {data:{user}}=await supabase.auth.getUser();
  if(!user) throw new Error('Sign in again to manage your posts.');
  const {data,error}=await supabase.from('professional_profiles').select('id').eq('user_id',user.id).single();
  if(error||!data) throw new Error('Your business profile could not be found.');
  return data.id;
}

export async function getProfessionalPosts():Promise<ProfessionalPost[]>{
  const professionalId=await getOwnProfessionalId();
  const {data,error}=await (supabase.from('feed_posts' as never) as any)
    .select('id,image_url,video_url,caption,created_at')
    .eq('professional_id',professionalId)
    .order('created_at',{ascending:false});
  if(error) throw error;
  return ((data??[]) as Array<{id:string;image_url:string;video_url:string|null;caption:string|null;created_at:string}>).map(post=>({
    id:post.id,
    imageUrl:post.image_url,
    videoUrl:post.video_url??null,
    caption:post.caption??'',
    createdAt:post.created_at,
  }));
}

/**
 * Deletes a post, then cleans up every asset it referenced.
 *
 * The database is the source of truth: storage cleanup runs best-effort after
 * the row is gone, so a transient provider error can never keep a deleted post
 * visible. Cloudinary clips are identified by public id; R2 images by key.
 */
export async function deleteProfessionalPost(post:ProfessionalPost){
  const professionalId=await getOwnProfessionalId();
  const {data:imageRows}=await (supabase.from('feed_post_images' as never) as any)
    .select('image_url')
    .eq('post_id',post.id);
  const urls=[
    ...new Set([
      post.imageUrl,
      ...(post.videoUrl?[post.videoUrl]:[]),
      ...((imageRows??[]) as Array<{image_url:string}>).map(row=>row.image_url),
    ]),
  ];

  const {error}=await supabase.from('feed_posts').delete().eq('id',post.id).eq('professional_id',professionalId);
  if(error) throw error;

  const media=urls
    .map(url=>identifyMedia(url))
    .filter((item):item is NonNullable<typeof item>=>item!==null);
  await Promise.allSettled(media.map(item=>deleteMedia(item).catch(()=>undefined)));

  invalidateFeedQueries();
}

export async function getStudioPhotos():Promise<StudioPhoto[]>{
  const professionalId=await getOwnProfessionalId();
  const {data,error}=await supabase.from('professional_studio_photos' as never).select('id,image_url,aspect_ratio,created_at').eq('professional_id',professionalId).order('sort_order').order('created_at');
  if(error)throw error;
  return ((data??[]) as unknown as Array<{id:string;image_url:string;aspect_ratio:number|string;created_at:string}>).map(row=>({id:row.id,imageUrl:row.image_url,aspectRatio:Number(row.aspect_ratio),createdAt:row.created_at}));
}

export async function addStudioPhoto(asset:UploadAsset){
  const professionalId=await getOwnProfessionalId();
  const media=await uploadMedia('portfolio',asset);
  const imageUrl=feedUrl(media);
  const {data,error}=await supabase.from('professional_studio_photos' as never).insert({professional_id:professionalId,image_url:imageUrl,aspect_ratio:asset.width/asset.height} as never).select('id,image_url,aspect_ratio,created_at').single();
  if(error){await deleteMedia(media).catch(()=>undefined);throw error}
  const row=data as unknown as{id:string;image_url:string;aspect_ratio:number|string;created_at:string};
  return{id:row.id,imageUrl:row.image_url,aspectRatio:Number(row.aspect_ratio),createdAt:row.created_at};
}

export async function deleteStudioPhoto(photo:StudioPhoto){
  const professionalId=await getOwnProfessionalId();
  const {error}=await supabase.from('professional_studio_photos' as never).delete().eq('id',photo.id).eq('professional_id',professionalId);
  if(error)throw error;
  const media=identifyMedia(photo.imageUrl);
  if(media)await deleteMedia(media).catch(()=>undefined);
}
