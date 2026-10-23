import { supabase } from '@/lib/supabase';
import { resolveProfileId } from '@/features/profile/api';
import { DEPOSIT_PERCENT, demoServices, type Service } from './data';

export type ServiceCategory={id:string;name:string};

const fallbackImage=demoServices[0].image;
function publicUrl(path?:string|null){return path?supabase.storage.from('profile-media').getPublicUrl(path).data.publicUrl:fallbackImage}

export async function fetchProfessionalServices(profileId:string):Promise<Service[]>{
 const resolvedId=await resolveProfileId(profileId);
 const{data,error}=await supabase.rpc('get_professional_services',{profile_id:resolvedId});
 if(error)throw error;
 return (data??[]).map((row,index)=>({id:row.id,name:row.name,category:row.category??'Service',price:Number(row.price),durationMinutes:row.duration_minutes,description:row.description,image:publicUrl(row.photos?.[0]?.storage_path),active:true,popular:index===0}));
}
export async function fetchProfessionalName(profileId:string):Promise<string>{
 const resolvedId=await resolveProfileId(profileId);
 const{data,error}=await supabase.from('professional_profiles').select('display_name,business_name').eq('id',resolvedId).single();
 if(error)throw error;
 return data.display_name?.trim()||data.business_name.trim();
}

export async function fetchProfessionalHandle(profileId:string):Promise<string>{
 const resolvedId=await resolveProfileId(profileId);
 const{data,error}=await (supabase.from('professional_profiles' as never) as any).select('id,handle').eq('id',resolvedId).single();
 if(error)throw error;
 return data.handle||data.id;
}

export async function fetchOwnServices():Promise<{profileId:string;countryCode:string;services:Service[]}>{
 const{data:{user}}=await supabase.auth.getUser();if(!user)throw new Error('Sign in to manage services.');
 const{data:profile,error:profileError}=await supabase.from('professional_profiles').select('id,country_code').eq('user_id',user.id).single();if(profileError)throw profileError;
 const[{data,error},{data:categories,error:categoryError}]=await Promise.all([supabase.from('professional_services').select('id,interest_id,name,description,price,duration_minutes,deposit_percentage,is_active').eq('professional_id',profile.id).order('sort_order'),supabase.from('interests').select('id,name').eq('is_active',true).order('sort_order')]);if(error)throw error;if(categoryError)throw categoryError;
 const ids=(data??[]).map(row=>row.id);const{data:photos}=ids.length?await supabase.from('service_photos').select('service_id,storage_path').in('service_id',ids):{data:[]};
 return{profileId:profile.id,countryCode:profile.country_code??'GH',services:(data??[]).map((row,index)=>({id:row.id,name:row.name,categoryId:row.interest_id??undefined,category:categories?.find(category=>category.id===row.interest_id)?.name??'Uncategorised',price:Number(row.price),durationMinutes:row.duration_minutes,description:row.description,image:publicUrl(photos?.find(photo=>photo.service_id===row.id)?.storage_path),active:row.is_active,popular:index===0}))};
}

export async function fetchServiceCategories():Promise<ServiceCategory[]>{const{data,error}=await supabase.from('interests').select('id,name').eq('is_active',true).order('sort_order');if(error)throw error;return data??[];}

export async function saveProfessionalService(profileId:string,service:Service){
 if(!service.categoryId)throw new Error('Choose a category for this service.');
 const values={interest_id:service.categoryId,name:service.name,description:service.description,price:service.price,duration_minutes:service.durationMinutes,deposit_percentage:DEPOSIT_PERCENT,is_active:service.active};
 const query=service.id.startsWith('local-')?supabase.from('professional_services').insert({...values,professional_id:profileId}):supabase.from('professional_services').update(values).eq('id',service.id);
 const{data,error}=await query.select('id').single();if(error)throw error;return data.id;
}

export async function uploadServicePhoto(serviceId:string,uri:string,name:string){
 const{data:{user}}=await supabase.auth.getUser();if(!user)throw new Error('Sign in to upload photos.');
 const response=await fetch(uri);const file=await response.arrayBuffer();const extension=(name.split('.').pop()||'jpg').toLowerCase();const path=`${user.id}/services/${serviceId}/${Date.now()}.${extension}`;const contentType=extension==='png'?'image/png':extension==='webp'?'image/webp':'image/jpeg';
 const{error:uploadError}=await supabase.storage.from('profile-media').upload(path,file,{contentType,upsert:false});if(uploadError)throw uploadError;
 const{error}=await supabase.from('service_photos').insert({service_id:serviceId,storage_path:path,alt_text:'Service result'});if(error)throw error;return publicUrl(path);
}
