import { supabase } from '@/lib/supabase';
import type { Category,Professional } from './data';
import {categoryImages} from './category-images';
import {cachedQuery} from '@/lib/query-cache';

type ExploreRow={id:string;name:string;category:string;location:string;rating:number|string;reviews:number;price:number|string;available:boolean;verified:boolean;image:string|null;is_new:boolean};
type NearbyRow=ExploreRow&{latitude:number;longitude:number;distance_metres:number};
export async function fetchExploreProfessionals():Promise<Professional[]>{
  return cachedQuery('public-explore:30',60_000,async()=>{const {data,error}=await supabase.rpc('get_explore_professionals',{result_limit:30});
  if(error) throw error;
  return ((data??[]) as ExploreRow[]).map(row=>({id:row.id,name:row.name,category:row.category,location:row.location,distance:0,rating:Number(row.rating),reviews:row.reviews,price:Number(row.price),available:row.available,verified:row.verified,image:row.image??'',new:row.is_new}));
  });
}

export async function fetchNearbyProfessionals(latitude:number,longitude:number,radiusMetres=400,resultLimit=20):Promise<Professional[]>{
  const{data,error}=await supabase.rpc('get_nearby_professionals' as never,{user_latitude:latitude,user_longitude:longitude,radius_metres:radiusMetres,result_limit:resultLimit} as never);
  if(error)throw error;
  return((data??[]) as NearbyRow[]).map(row=>({id:row.id,name:row.name,category:row.category,location:row.location,distance:row.distance_metres,rating:Number(row.rating),reviews:row.reviews,price:Number(row.price),available:row.available,verified:row.verified,image:row.image??'',new:row.is_new,latitude:row.latitude,longitude:row.longitude}));
}

export async function fetchMapProfessionals(latitude:number,longitude:number,resultLimit=500):Promise<Professional[]>{
  const{data,error}=await supabase.rpc('get_map_professionals' as never,{user_latitude:latitude,user_longitude:longitude,result_limit:resultLimit} as never);
  if(error)throw error;
  return((data??[]) as NearbyRow[]).map(row=>({id:row.id,name:row.name,category:row.category,location:row.location,distance:row.distance_metres,rating:Number(row.rating),reviews:row.reviews,price:Number(row.price),available:row.available,verified:row.verified,image:row.image??'',new:row.is_new,latitude:row.latitude,longitude:row.longitude}));
}

export async function fetchProfessionalsByCategory(slug:string):Promise<Professional[]>{
  const{data,error}=await supabase.rpc('get_explore_professionals_by_category' as never,{category_slug:slug,result_limit:30} as never);
  if(error)throw error;
  return ((data??[]) as ExploreRow[]).map(row=>({id:row.id,name:row.name,category:row.category,location:row.location,distance:0,rating:Number(row.rating),reviews:row.reviews,price:Number(row.price),available:row.available,verified:row.verified,image:row.image??'',new:row.is_new}));
}

const categoryColors=['#F2D8DE','#E6DCEB','#D8E4DC','#EAD9CF','#E8DDE2','#E7E0D5'];
export async function fetchExploreCategories():Promise<Category[]>{
  return cachedQuery('public-categories',10*60_000,async()=>{const{data,error}=await supabase.from('interests').select('id,name,slug,image_url').eq('is_active',true).order('sort_order');
  if(error)throw error;
  return(data??[]).map((row,index)=>({id:row.id,name:row.name,slug:row.slug,image:categoryImages[row.slug]??row.image_url,blush:categoryColors[index%categoryColors.length]}));
  });
}
