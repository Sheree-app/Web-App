/**
 * Supabase schema types, carried over from the mobile client unchanged so both
 * codebases agree on column names and RPC signatures.
 */
export type UserRole = "customer" | "professional";

type ReactionTable = {
  Row: { post_id: string; user_id: string; created_at: string };
  Insert: { post_id: string; user_id: string; created_at?: string };
  Update: never;
  Relationships: [];
};

export type FeedComment = {
  id: string;
  postId: string;
  userId: string;
  parentId: string | null;
  body: string;
  createdAt: string;
  authorName: string;
  avatarUrl: string | null;
  replyCount: number;
  replyToName: string | null;
};

type UsersTable = {
  Row: {
    id: string;
    role: UserRole;
    username: string;
    avatar_url: string | null;
    phone: string | null;
    onboarding_step: string;
    onboarding_completed_at: string | null;
    wants_professional_account: boolean;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id: string;
    role?: UserRole;
    username: string;
    avatar_url?: string | null;
    phone?: string | null;
    onboarding_step?: string;
    onboarding_completed_at?: string | null;
    wants_professional_account?: boolean;
  };
  Update: {
    username?: string;
    avatar_url?: string | null;
    phone?: string | null;
    onboarding_step?: string;
    onboarding_completed_at?: string | null;
    wants_professional_account?: boolean;
  };
  Relationships: [];
};

type ProfessionalProfilesTable = {
  Row: {
    id: string;
    user_id: string;
    business_name: string;
    display_name: string | null;
    bio: string | null;
    location: string | null;
    country_code: string;
    is_verified: boolean;
    profile_photo_url: string | null;
    cover_image_url: string | null;
    years_experience: number | null;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    user_id: string;
    business_name: string;
    display_name?: string | null;
    bio?: string | null;
    location?: string | null;
    country_code?: string;
    profile_photo_url?: string | null;
    cover_image_url?: string | null;
    years_experience?: number | null;
  };
  Update: {
    business_name?: string;
    display_name?: string | null;
    bio?: string | null;
    location?: string | null;
    country_code?: string;
    profile_photo_url?: string | null;
    cover_image_url?: string | null;
    years_experience?: number | null;
  };
  Relationships: [];
};

type InterestsTable = {
  Row: {
    id: string;
    name: string;
    slug: string;
    image_url: string | null;
    sort_order: number;
    is_active: boolean;
    created_at: string;
  };
  Insert: {
    id?: string;
    name: string;
    slug: string;
    image_url?: string | null;
    sort_order?: number;
    is_active?: boolean;
  };
  Update: { name?: string; image_url?: string | null; sort_order?: number; is_active?: boolean };
  Relationships: [];
};

type UserInterestsTable = {
  Row: { user_id: string; interest_id: string; created_at: string };
  Insert: { user_id: string; interest_id: string; created_at?: string };
  Update: never;
  Relationships: [];
};

type ServicesTable = {
  Row: {
    id: string;
    professional_id: string;
    interest_id: string | null;
    name: string;
    description: string;
    price: number;
    duration_minutes: number;
    deposit_percentage: number;
    is_active: boolean;
    sort_order: number;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    professional_id: string;
    interest_id?: string | null;
    name: string;
    description: string;
    price: number;
    duration_minutes: number;
    deposit_percentage: number;
    is_active?: boolean;
    sort_order?: number;
  };
  Update: {
    interest_id?: string | null;
    name?: string;
    description?: string;
    price?: number;
    duration_minutes?: number;
    deposit_percentage?: number;
    is_active?: boolean;
    sort_order?: number;
  };
  Relationships: [];
};

type ServicePhotosTable = {
  Row: {
    id: string;
    service_id: string;
    storage_path: string;
    alt_text: string | null;
    sort_order: number;
    created_at: string;
  };
  Insert: {
    id?: string;
    service_id: string;
    storage_path: string;
    alt_text?: string | null;
    sort_order?: number;
  };
  Update: { alt_text?: string | null; sort_order?: number };
  Relationships: [];
};

type FeedPostsTable = {
  Row: {
    id: string;
    professional_id: string;
    interest_id: string;
    image_url: string;
    caption: string;
    price_from: number | null;
    aspect_ratio: number;
    rating: number;
    rating_count: number;
    is_published: boolean;
    created_at: string;
    updated_at: string;
  };
  Insert: {
    id?: string;
    professional_id: string;
    interest_id: string;
    image_url: string;
    caption: string;
    price_from?: number | null;
    aspect_ratio?: number;
    is_published?: boolean;
  };
  Update: {
    caption?: string;
    price_from?: number | null;
    interest_id?: string;
    is_published?: boolean;
  };
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      users: UsersTable;
      user_interests: UserInterestsTable;
      professional_profiles: ProfessionalProfilesTable;
      interests: InterestsTable;
      professional_services: ServicesTable;
      service_photos: ServicePhotosTable;
      feed_posts: FeedPostsTable;
      feed_post_likes: ReactionTable;
      feed_post_saves: ReactionTable;
    };
    Views: { [_ in never]: never };
    Functions: {
      get_explore_professionals: {
        Args: { result_limit?: number };
        Returns: Array<Record<string, unknown>>;
      };
      get_personalized_feed: {
        Args: { page_number?: number; page_size?: number };
        Returns: Array<Record<string, unknown>>;
      };
      get_professional_services: {
        Args: { profile_id: string };
        Returns: Array<{
          id: string;
          name: string;
          description: string;
          price: number;
          duration_minutes: number;
          deposit_percentage: number;
          category: string | null;
          photos: Array<{ id: string; storage_path: string; alt_text: string | null }>;
        }>;
      };
      get_my_schedule: { Args: Record<string, never>; Returns: Record<string, unknown> };
      save_my_schedule: { Args: { payload: Record<string, unknown> }; Returns: undefined };
      get_booking_availability: {
        Args: { profile_id: string; service_id: string; from_date: string; day_count?: number };
        Returns: Array<{ date: string; state: "available" | "limited" | "full" | "closed" }>;
      };
      reserve_booking: { Args: { service_id: string; starts_at: string; notes?: string | null }; Returns: string };
      complete_customer_onboarding: { Args: { interest_slugs: string[] }; Returns: undefined };
      complete_professional_onboarding: {
        Args: {
          category_slug: string;
          business_name_value: string;
          display_name_value: string;
          bio_value: string;
          years_experience_value: number | null;
          business_address_value: string;
          travel_radius_value: number | null;
          offers_mobile_value: boolean;
          deposit_value: number;
          cancellation_policy_value: string;
          open_day_numbers: number[];
          instagram_url_value: string | null;
        };
        Returns: undefined;
      };
      set_my_professional_intent: { Args: { value: boolean }; Returns: undefined };
    };
    Enums: { user_role: UserRole };
    CompositeTypes: { [_ in never]: never };
  };
};
