import { redirect } from "next/navigation";

/** 예전 공개 가이드 주소. 이용방법은 /guide 한 곳으로 합쳤어요. */
export default function LegacyGuidesPage() {
  redirect("/guide");
}
