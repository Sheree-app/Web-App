import { api } from '@/lib/api';
import type { Category,Professional } from './data';
import {categoryImages} from './category-images';
import {cachedQuery,STALE} from '@/lib/query-cache';

/**
 * Explore reads from the Sheree API (`sheree-backend/docs/api/discovery.md`).
 * Every route is public; the token is sent when signed in (`auth: 'optional'`)
 * as the API asks, but it adds no fields.
 */
type ExploreRow={id:string;name:string;category:string;location:string;rating:number;reviews:number;price:number;available:boolean;verified:boolean;founding:boolean;official:boolean;image:string|null;is_new:boolean};
type NearbyRow=ExploreRow&{latitude:number;longitude:number;distance_metres:number};
type CategoryRow={id:string;name:string;slug:string;image_url:string|null};

const toProfessional=(row:ExploreRow,distance=0):Professional=>({id:row.id,name:row.name,category:row.category,location:row.location,distance,rating:Number(row.rating),reviews:Number(row.reviews),price:Number(row.price),available:row.available,verified:row.verified,image:row.image??'',new:row.is_new});
const toPinned=(row:NearbyRow):Professional=>({...toProfessional(row,row.distance_metres),latitude:row.latitude,longitude:row.longitude});

/** Cache keys (public data: the same for everyone). */
export const EXPLORE_PROS_KEY='pub:explore:pros:30';
export const CATEGORIES_KEY='pub:categories';
export const categoryProsKey=(slug:string)=>`pub:explore:category:${slug}`;
// Positions are rounded to ~1 km so small GPS jitter reuses the cached answer.
const place=(latitude:number,longitude:number)=>`${latitude.toFixed(2)},${longitude.toFixed(2)}`;
export const mapProsKey=(latitude:number,longitude:number,resultLimit=500)=>`pub:explore:map:${place(latitude,longitude)}:${resultLimit}`;
export const nearbyProsKey=(latitude:number,longitude:number,radiusMetres=400,resultLimit=20)=>`pub:explore:nearby:${place(latitude,longitude)}:${radiusMetres}:${resultLimit}`;

/** `GET /v1/explore/professionals`; always a network read (see `useExploreProfessionals`). */
export async function loadExploreProfessionals():Promise<Professional[]>{
  return(await api.get<ExploreRow[]>('/v1/explore/professionals',{auth:'optional',query:{limit:30}})).map(row=>toProfessional(row));
}

export async function fetchExploreProfessionals():Promise<Professional[]>{
  return cachedQuery(EXPLORE_PROS_KEY,STALE.medium,loadExploreProfessionals);
}

export async function fetchNearbyProfessionals(latitude:number,longitude:number,radiusMetres=400,resultLimit=20):Promise<Professional[]>{
  const rows=await api.get<NearbyRow[]>('/v1/explore/nearby',{
    auth:'optional',
    // The API accepts 50–50,000 m.
    query:{lat:latitude,lng:longitude,radius:Math.min(50_000,Math.max(50,Math.round(radiusMetres))),limit:resultLimit},
  });
  return rows.map(toPinned);
}

export async function fetchMapProfessionals(latitude:number,longitude:number,resultLimit=500):Promise<Professional[]>{
  const rows=await api.get<NearbyRow[]>('/v1/explore/map',{auth:'optional',query:{lat:latitude,lng:longitude,limit:resultLimit}});
  return rows.map(toPinned);
}

export async function fetchProfessionalsByCategory(slug:string):Promise<Professional[]>{
  const rows=await api.get<ExploreRow[]>('/v1/explore/professionals',{auth:'optional',query:{category:slug,limit:30}});
  return rows.map(row=>toProfessional(row));
}

const categoryColors=['#F2D8DE','#E6DCEB','#D8E4DC','#EAD9CF','#E8DDE2','#E7E0D5'];
/** `GET /v1/categories`; always a network read (see `useExploreCategories`). */
export async function loadExploreCategories():Promise<Category[]>{
  return(await api.get<CategoryRow[]>('/v1/categories',{auth:'optional'})).map((row,index)=>({id:row.id,name:row.name,slug:row.slug,image:categoryImages[row.slug]??row.image_url,blush:categoryColors[index%categoryColors.length]}));
}

export async function fetchExploreCategories():Promise<Category[]>{
  return cachedQuery(CATEGORIES_KEY,STALE.long,loadExploreCategories);
}
