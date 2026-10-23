export type FeedPost = {
  id: string;
  slug?: string;
  professionalId: string;
  professionalName: string;
  avatarUrl: string | null;
  /** Poster frame for a clip; the image itself for a picture post. */
  imageUrl: string;
  /** Cloudinary delivery URL for a clip post, null for picture posts. */
  videoUrl: string | null;
  videoDurationMs: number | null;
  caption: string;
  category: string;
  location: string;
  priceFrom: number | null;
  serviceId: string | null;
  rating: number;
  ratingCount: number;
  verified: boolean;
  founding: boolean;
  official: boolean;
  likeCount: number;
  commentCount: number;
  liked: boolean;
  saved: boolean;
  aspectRatio: number;
  createdAt: string;
};
