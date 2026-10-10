import type { MetadataRoute } from "next";
import { PROTECTED_PREFIXES } from "@/lib/supabase/route-access";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/auth/", ...PROTECTED_PREFIXES],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
