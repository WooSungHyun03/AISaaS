import { PageLoading } from "@/components/ui/page-state";

export default function PublicLoading() {
  return <div className="mx-auto w-full max-w-7xl px-4 py-12 sm:px-6"><PageLoading cards={3} rows={3} /></div>;
}
