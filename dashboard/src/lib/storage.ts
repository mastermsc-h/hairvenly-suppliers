// Helpers für Public-URLs aus dem `supplier-banners` Storage-Bucket.
const BUCKET = "supplier-banners";

function publicUrl(path: string | null): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return `${base}/storage/v1/object/public/${BUCKET}/${path}`;
}

export const publicAvatarUrl = publicUrl;
export const publicOverviewUrl = publicUrl;

// Backward compat — falls noch irgendwo verwendet.
export const publicBannerUrl = publicUrl;

export function isImageFile(path: string | null): boolean {
  if (!path) return false;
  return /\.(png|jpe?g|gif|webp|svg|bmp|heic|heif)$/i.test(path);
}

export function isPdfFile(path: string | null): boolean {
  if (!path) return false;
  return /\.pdf$/i.test(path);
}
