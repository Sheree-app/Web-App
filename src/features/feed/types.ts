export type FeedPost = {
  id: string;
  professionalId: string;
  professionalName: string;
  avatarUrl: string | null;
  imageUrl: string;
  caption: string;
  category: string;
  location: string;
  priceFrom: number | null;
  rating: number;
  ratingCount: number;
  verified: boolean;
  likeCount: number;
  commentCount: number;
  liked: boolean;
  saved: boolean;
  aspectRatio: number;
  createdAt: string;
};

