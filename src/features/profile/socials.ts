export const SOCIAL_PLATFORMS = [
  { key: 'instagram', label: 'Instagram', icon: 'logo-instagram', placeholder: '@yourstudio' },
  { key: 'tiktok', label: 'TikTok', icon: 'logo-tiktok', placeholder: '@yourstudio' },
  { key: 'facebook', label: 'Facebook', icon: 'logo-facebook', placeholder: 'yourstudio' },
  { key: 'x', label: 'X', icon: 'logo-twitter', placeholder: '@yourstudio' },
  { key: 'youtube', label: 'YouTube', icon: 'logo-youtube', placeholder: '@yourstudio' },
  { key: 'snapchat', label: 'Snapchat', icon: 'logo-snapchat', placeholder: 'yourstudio' },
] as const;

export type SocialPlatform = typeof SOCIAL_PLATFORMS[number]['key'];
export type SocialLinks = Record<SocialPlatform, string | null>;

export const EMPTY_SOCIAL_LINKS: SocialLinks = {
  instagram: null,
  tiktok: null,
  facebook: null,
  x: null,
  youtube: null,
  snapchat: null,
};

const PROFILE_URLS: Record<SocialPlatform, (username: string) => string> = {
  instagram: username => `https://www.instagram.com/${username}`,
  tiktok: username => `https://www.tiktok.com/@${username}`,
  facebook: username => `https://www.facebook.com/${username}`,
  x: username => `https://x.com/${username}`,
  youtube: username => `https://www.youtube.com/@${username}`,
  snapchat: username => `https://www.snapchat.com/add/${username}`,
};

const RESERVED_PATHS = new Set(['add', 'channel', 'c', 'user']);

export function socialUsername(input: string | null): string {
  const value = input?.trim() ?? '';
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) return value.replace(/^@/, '');
  try {
    const parts = new URL(value).pathname.split('/').filter(Boolean);
    const candidate = parts.at(-1) ?? '';
    return candidate.replace(/^@/, '');
  } catch {
    return value.replace(/^@/, '');
  }
}

export function normalizeSocialLink(platform: SocialPlatform, input: string): string | null {
  const username = socialUsername(input);
  if (!username) return null;
  if (RESERVED_PATHS.has(username.toLowerCase()) || !/^[a-zA-Z0-9._-]{1,100}$/.test(username)) {
    throw new Error(`Enter only your ${SOCIAL_PLATFORMS.find(item => item.key === platform)?.label} username.`);
  }
  return PROFILE_URLS[platform](username);
}
