import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { ConnectorError } from "@/server/shared/errors";
import type { Database } from "@/types/database.types";
import { MARKETING_CARD_PNG_BASE64 } from "./assets/marketing-card";

type DbClient = SupabaseClient<Database>;

export const MARKETING_ASSETS_BUCKET = "marketing-assets";
const MARKETING_CARD_DIR = "instagram";
const MARKETING_CARD_FILENAME = "marketing-card.png";
const MARKETING_CARD_PATH = `${MARKETING_CARD_DIR}/${MARKETING_CARD_FILENAME}`;

/**
 * Ensures Day 9's single static marketing-card image exists in the public
 * `marketing-assets` Storage bucket (created by
 * `supabase/migrations/0027_instagram_marketing_assets_bucket.sql`) and
 * returns its public URL for Meta's API to fetch by `image_url`. Uploads
 * only when the object isn't already there — every automation run calls
 * this, so a cheap existence check avoids re-uploading the same bytes on
 * every single post while staying self-healing if the bucket is ever
 * emptied.
 */
export async function ensureMarketingCardImageUrl(admin: DbClient = createAdminClient()): Promise<string> {
  const bucket = admin.storage.from(MARKETING_ASSETS_BUCKET);

  const { data: existing, error: listError } = await bucket.list(MARKETING_CARD_DIR, { search: MARKETING_CARD_FILENAME });
  if (listError) {
    throw new ConnectorError("instagram", "UPSTREAM_SERVER_ERROR", `마케팅 카드 이미지를 확인하지 못했습니다: ${listError.message}`);
  }

  if (!existing?.some((file) => file.name === MARKETING_CARD_FILENAME)) {
    const buffer = Buffer.from(MARKETING_CARD_PNG_BASE64, "base64");
    const { error: uploadError } = await bucket.upload(MARKETING_CARD_PATH, buffer, {
      contentType: "image/png",
      upsert: true,
    });
    if (uploadError) {
      throw new ConnectorError("instagram", "UPSTREAM_SERVER_ERROR", `마케팅 카드 이미지를 업로드하지 못했습니다: ${uploadError.message}`);
    }
  }

  const { data: publicUrlData } = bucket.getPublicUrl(MARKETING_CARD_PATH);
  if (!publicUrlData?.publicUrl) {
    throw new ConnectorError("instagram", "UPSTREAM_SERVER_ERROR", "마케팅 카드 이미지 URL을 생성하지 못했습니다.");
  }
  return publicUrlData.publicUrl;
}
