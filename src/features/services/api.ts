import { api } from '@/lib/api';
import { AppError, errorCode } from '@/lib/errors';
import { deleteMedia, mediaAssetFromFile, uploadMedia } from '@/lib/media';
import { invalidateCached, invalidateCachedPrefix } from '@/lib/query-cache';
import { demoServices, type Service } from './data';

/**
 * Services through the Sheree API (`sheree-backend/docs/api/profiles.md`,
 * `pro-services.md`). Photos go through the media pipeline (R2, resized WebP)
 * and are attached by upload id.
 */
export type ServiceCategory={id:string;name:string};

/** Cache keys (`useQuery`, `./queries.ts`). The own list is per signed-in pro. */
export const OWN_SERVICES_KEY='me:services';
export const publicServicesKey=(profileKey:string)=>`pub:services:${profileKey.trim()}`;
export const publicProNameKey=(profileKey:string)=>`pub:pro-name:${profileKey.trim()}`;

/**
 * After a service changes: her own list, and every public view of her menu
 * and profile (keyed by handle or id, so all `pub:` keys are marked stale).
 */
export function invalidateServiceQueries(){
 invalidateCached(OWN_SERVICES_KEY);
 invalidateCachedPrefix('pub:');
}

// Service cards always show a picture; one without a photo gets the demo image.
const fallbackImage=demoServices[0].image;

type PublicProfileRow={id:string;handle:string|null;name:string|null;business_name:string|null};
const fetchPublicProfile=(profileKey:string)=>
 api.get<PublicProfileRow>(`/v1/professionals/${encodeURIComponent(profileKey.trim())}`,{auth:'optional'});

type PublicServiceRow={id:string;name:string;description:string|null;price:number;duration_minutes:number;deposit_percentage:number|null;category:string;image_url:string|null};
// `profileKey` is a public handle when opened from a share link, or a UUID
// during in-app navigation; the API resolves both and returns photo URLs.
export async function fetchProfessionalServices(profileKey:string):Promise<Service[]>{
 const rows=await api.get<PublicServiceRow[]>(`/v1/professionals/${encodeURIComponent(profileKey.trim())}/services`,{auth:'optional'});
 return rows.map((row,index)=>({id:row.id,name:row.name,category:row.category??'Service',price:Number(row.price),durationMinutes:row.duration_minutes,description:row.description??'',image:row.image_url??fallbackImage,active:true,popular:index===0}));
}

export async function fetchProfessionalName(profileKey:string):Promise<string>{
 const profile=await fetchPublicProfile(profileKey);
 // `name` is the display name, else the business name.
 return profile.name?.trim()||profile.business_name?.trim()||'Professional';
}

export async function fetchProfessionalHandle(profileKey:string):Promise<string>{
 const profile=await fetchPublicProfile(profileKey);
 return profile.handle||profile.id;
}

type OwnServiceRow={id:string;interest_id:string|null;category:string;name:string;description:string|null;price:number;duration_minutes:number;deposit_percentage:number;is_active:boolean;sort_order:number;image:string|null};
type PracticeCategoryRow={id:string;name:string;is_primary:boolean};
const toOwnService=(row:OwnServiceRow,index:number):Service=>({id:row.id,name:row.name,categoryId:row.interest_id??undefined,category:row.category??'Uncategorised',price:Number(row.price),durationMinutes:row.duration_minutes,description:row.description??'',image:row.image??fallbackImage,active:row.is_active,popular:index===0});

export async function fetchOwnServices():Promise<{profileId:string;countryCode:string;services:Service[];categories:ServiceCategory[]}>{
 const data=await api.get<{profile_id:string;country_code:string;categories:PracticeCategoryRow[];services:OwnServiceRow[]}>('/v1/me/services');
 return{profileId:data.profile_id,countryCode:data.country_code??'GH',categories:data.categories.map(({id,name})=>({id,name})),services:data.services.map(toOwnService)};
}

/** Every active category; picking one outside the practice adds it on save. */
export async function fetchServiceCategories():Promise<ServiceCategory[]>{
 return(await api.get<Array<{id:string;name:string}>>('/v1/categories',{auth:'optional'})).map(({id,name})=>({id,name}));
}

/** Only the categories in the professional's practice, primary first. */
export async function fetchProfessionalCategories():Promise<ServiceCategory[]>{
 return(await api.get<PracticeCategoryRow[]>('/v1/me/categories')).map(({id,name})=>({id,name}));
}

/** Adds a category to the professional's practice (idempotent). */
export async function addProfessionalCategory(interestId:string):Promise<void>{
 await api.put(`/v1/me/categories/${encodeURIComponent(interestId)}`);
}

/**
 * Creates (`local-…` ids) or updates a service and returns its id. The server
 * sets the platform deposit; in Ghana without a payout account it refuses with
 * a message written for the user.
 */
export async function saveProfessionalService(_profileId:string,service:Service):Promise<string>{
 if(!service.categoryId)throw new AppError('Choose a category for this service.','validation');
 const values={interest_id:service.categoryId,name:service.name.trim(),description:service.description.trim(),price:service.price,duration_minutes:service.durationMinutes,is_active:service.active};
 const save=()=>service.id.startsWith('local-')
  ?api.post<OwnServiceRow>('/v1/me/services',{body:values})
  :api.patch<OwnServiceRow>(`/v1/me/services/${encodeURIComponent(service.id)}`,{body:values});
 try{
  const id=(await save()).id;
  invalidateServiceQueries();
  return id;
 }catch(error){
  // The web editor offers every category (as before the API); the server only
  // accepts the practice's, so add the chosen one and try once more.
  if(errorCode(error)==='category_not_in_practice'){
   await addProfessionalCategory(service.categoryId);
   const id=(await save()).id;
   invalidateServiceQueries();
   return id;
  }
  throw error;
 }
}

/**
 * Uploads a service photo through the media pipeline and sets it on the
 * service. The server replaces and deletes any older photo. Returns its URL.
 */
export async function uploadServicePhoto(serviceId:string,uri:string,name:string):Promise<string>{
 const blob=await fetch(uri).then(response=>response.blob());
 const asset=await mediaAssetFromFile(new File([blob],name,{type:blob.type}));
 const media=await uploadMedia('service',asset);
 try{
  const saved=await api.put<OwnServiceRow>(`/v1/me/services/${encodeURIComponent(serviceId)}/photo`,{body:{media_id:media.mediaId}});
  invalidateServiceQueries();
  return saved.image??fallbackImage;
 }catch(error){
  await deleteMedia(media).catch(()=>undefined);
  throw error;
 }
}
