import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Easy Marketing",
    short_name: "이지 마케팅",
    description: "사장님을 위한 AI 마케팅 도우미",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#f6f8fc",
    theme_color: "#0e1e45",
    lang: "ko",
    icons: [
      { src: "/icons/android-icon-144x144.png", sizes: "144x144", type: "image/png" },
      { src: "/icons/android-icon-192x192.png", sizes: "192x192", type: "image/png" },
    ],
  };
}
