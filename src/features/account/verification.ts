import type { MediaAsset } from "@/lib/media/types";
import { supabase } from "@/lib/supabase";

export type VerificationDocumentType = "identity" | "business_registration";

export async function uploadVerificationDocument(
  userId: string,
  type: VerificationDocumentType,
  asset: MediaAsset,
) {
  const { data: profile, error: profileError } = await supabase
    .from("professional_profiles")
    .select("id")
    .eq("user_id", userId)
    .single();
  if (profileError) throw profileError;
  const extension = (
    asset.fileName?.split(".").pop() ||
    asset.mimeType?.split("/").pop() ||
    "jpg"
  )
    .toLowerCase()
    .replace("jpeg", "jpg");
  const path = `${userId}/${type}-${Date.now()}.${extension}`;
  const file = await fetch(asset.uri).then((response) =>
    response.arrayBuffer(),
  );
  const { error: uploadError } = await supabase.storage
    .from("verification-documents")
    .upload(path, file, {
      contentType: asset.mimeType || "image/jpeg",
      upsert: false,
    });
  if (uploadError) throw uploadError;
  const table = supabase.from(
    "professional_verification_documents" as never,
  ) as any;
  const { error: deleteError } = await table
    .delete()
    .eq("professional_id", profile.id)
    .eq("document_type", type)
    .eq("status", "pending");
  if (deleteError) {
    await supabase.storage.from("verification-documents").remove([path]);
    throw deleteError;
  }
  const { error: insertError } = await table.insert({
    professional_id: profile.id,
    document_type: type,
    storage_path: path,
    status: "pending",
  });
  if (insertError) {
    await supabase.storage.from("verification-documents").remove([path]);
    throw insertError;
  }
}
