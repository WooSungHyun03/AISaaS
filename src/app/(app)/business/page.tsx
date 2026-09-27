import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BusinessFormDialog } from "@/components/business/business-form-dialog";
import { DeleteBusinessButton } from "@/components/business/delete-business-button";
import { Building2, Plus } from "lucide-react";
import { EmptyState } from "@/components/ui/page-state";

export default async function BusinessPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: businesses, error } = await supabase
    .from("businesses")
    .select("*")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true });
  if (error) throw new Error("사업체 정보를 불러오지 못했습니다.", { cause: error });

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">사업체 프로필</h1>
          <p className="text-sm text-muted-foreground">자동화가 콘텐츠를 생성할 때 참고하는 사업 정보입니다.</p>
        </div>
        <BusinessFormDialog trigger={<Button className="w-full sm:w-auto"><Plus aria-hidden="true" /> 새 사업체 등록</Button>} />
      </div>

      {(businesses ?? []).length === 0 ? (
        <EmptyState
          icon={<Building2 className="size-5" />}
          title="등록된 사업체가 없습니다"
          description="업체명과 핵심 정보만 등록하면 내 사업에 맞는 자동화를 만들 수 있습니다."
          action={<BusinessFormDialog trigger={<Button>첫 사업체 등록</Button>} />}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(businesses ?? []).map((business) => (
            <Card key={business.id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <CardTitle className="text-base">{business.name}</CardTitle>
                  {business.industry ? <Badge variant="outline">{business.industry}</Badge> : null}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {business.description ? <p className="whitespace-pre-line text-sm text-muted-foreground">{business.description}</p> : null}
                <div className="flex flex-wrap gap-1">
                  {business.keywords.map((keyword) => (
                    <Badge key={keyword} variant="secondary" className="font-normal">
                      {keyword}
                    </Badge>
                  ))}
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <BusinessFormDialog
                    business={business}
                    trigger={
                      <Button variant="outline" size="sm">
                        수정
                      </Button>
                    }
                  />
                  <DeleteBusinessButton businessId={business.id} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
