import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BusinessFormDialog } from "@/components/business/business-form-dialog";
import { DeleteBusinessButton } from "@/components/business/delete-business-button";

export default async function BusinessPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: businesses } = await supabase
    .from("businesses")
    .select("*")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">사업체 프로필</h1>
          <p className="text-sm text-muted-foreground">자동화가 콘텐츠를 생성할 때 참고하는 사업 정보입니다.</p>
        </div>
        <BusinessFormDialog trigger={<Button>새 사업체 등록</Button>} />
      </div>

      {(businesses ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            등록된 사업체가 없습니다. 사업체를 등록하고 자동화를 시작해보세요.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(businesses ?? []).map((business) => (
            <Card key={business.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
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
