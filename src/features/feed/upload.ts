import { deleteMedia, feedUrl, uploadMedia, type UploadedMedia } from '@/lib/media';
import { identifyMedia } from '@/lib/media/urls';
import { supabase } from '@/lib/supabase';

export type PostCategory={id:string;name:string};
export type ProfessionalPost={id:string;imageUrl:string;caption:string;createdAt:string};
export type StudioPhoto={id:string;imageUrl:string;aspectRatio:number;createdAt:string};
export async function getPostCategories():Promise<PostCategory[]> {
  const {data,error}=await supabase.from('interests').select('id,name').order('name');
  if(error) throw error;
  return data??[];
}
type UploadAsset={uri:string;mimeType?:string|null;fileName?:string|null;width:number;height:number};
export async function publishFeedPost(input:{assets:UploadAsset[];caption:string;interestId:string;priceFrom:number|null},onProgress?:(completed:number)=>void){
  if(input.assets.length<1||input.assets.length>8) throw new Error('Choose between 1 and 8 pictures.');
  const {data:{user}}=await supabase.auth.getUser();
  if(!user) throw new Error('Sign in again to publish your work.');
  const {data:profile,error:profileError}=await supabase.from('professional_profiles').select('id').eq('user_id',user.id).single();
  if(profileError||!profile) throw new Error('Finish your business profile before posting.');
  const uploaded:Array<{media:UploadedMedia;width:number;height:number}>=[];
  try{
    for(const [index,asset] of input.assets.entries()){
      // Feed cards render the 720px feed variant; no full-res originals are
      // shipped to the feed.
      const media=await uploadMedia('post',asset);
      uploaded.push({media,width:asset.width,height:asset.height});
      onProgress?.(index+1);
    }
    const cover=uploaded[0];
    const {data:post,error:postError}=await supabase.from('feed_posts').insert({professional_id:profile.id,interest_id:input.interestId,image_url:feedUrl(cover.media),caption:input.caption.trim(),price_from:input.priceFrom,aspect_ratio:cover.width/cover.height}).select('id').single();
    if(postError)throw postError;
    const {error:imageError}=await (supabase.from('feed_post_images' as never) as any).insert(uploaded.map((item,index)=>({post_id:post.id,image_url:feedUrl(item.media),aspect_ratio:item.width/item.height,sort_order:index})));
    if(imageError){await supabase.from('feed_posts').delete().eq('id',post.id);throw imageError}
  }catch(error){
    await Promise.allSettled(uploaded.map(item=>deleteMedia(item.media).catch(()=>undefined)));
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
  const {data,error}=await supabase.from('feed_posts').select('id,image_url,caption,created_at').eq('professional_id',professionalId).order('created_at',{ascending:false});
  if(error) throw error;
  return (data??[]).map(post=>({id:post.id,imageUrl:post.image_url,caption:post.caption,createdAt:post.created_at}));
}

export async function deleteProfessionalPost(post:ProfessionalPost){
  const professionalId=await getOwnProfessionalId();
  const {data:imageRows}=await (supabase.from('feed_post_images' as never) as any)
    .select('image_url')
    .eq('post_id',post.id);
  const imageUrls=[
    ...new Set([post.imageUrl,...((imageRows??[]) as Array<{image_url:string}>).map(row=>row.image_url)]),
  ];
  const {error}=await supabase.from('feed_posts').delete().eq('id',post.id).eq('professional_id',professionalId);
  if(error) throw error;

  // The database is the source of truth. Image cleanup is best-effort so a
  // transient storage error never leaves a deleted post visible in the feed.
  const media=imageUrls
    .map(url=>identifyMedia(url))
    .filter((item):item is NonNullable<typeof item>=>item!==null);
  await Promise.allSettled(media.map(item=>deleteMedia(item).catch(()=>undefined)));
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
