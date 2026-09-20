import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TemplateCard } from "@/components/automations/template-card";
import { createClient } from "@/lib/supabase/server";

const STEPS = [
  { title: "1. 사업 정보 등록", description: "업종, 브랜드 톤, 타겟 고객 등 사업 정보를 한 번만 입력합니다." },
  { title: "2. 자동화 선택", description: "블로그, 인스타그램, 뉴스레터 등 원하는 업무 자동화를 고르고 주기를 설정합니다." },
  { title: "3. 자동 실행", description: "AI가 정해진 주기에 콘텐츠를 생성하고 게시까지 자동으로 수행합니다." },
];

export default async function LandingPage() {
  const supabase = await createClient();
  const { data: templates } = await supabase
    .from("automation_templates")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  return (
    <div className="mx-auto max-w-6xl space-y-24 px-4 py-16">
      <section className="mx-auto max-w-3xl space-y-6 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          사업 정보를 한 번 입력하면,
          <br />
          AI가 업무를 반복 자동화합니다.
        </h1>
        <p className="text-lg text-muted-foreground">
          1인 사업자와 소규모 팀을 위한 AI 업무 자동화 SaaS. AI 툴 목록이 아니라, 실제로 일이 돌아가는 자동화입니다.
        </p>
        <div className="flex justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/signup">무료로 시작하기</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/automations/marketplace">자동화 둘러보기</Link>
          </Button>
        </div>
      </section>

      <section className="grid gap-6 sm:grid-cols-3">
        {STEPS.map((step) => (
          <Card key={step.title}>
            <CardHeader>
              <CardTitle className="text-base">{step.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{step.description}</CardContent>
          </Card>
        ))}
      </section>

      <section className="space-y-6">
        <div className="flex items-end justify-between">
          <h2 className="text-2xl font-semibold tracking-tight">자동화 마켓플레이스</h2>
          <Link href="/pricing" className="text-sm text-muted-foreground underline underline-offset-4">
            요금제 보기
          </Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(templates ?? []).map((template) => (
            <TemplateCard key={template.id} template={template} />
          ))}
        </div>
      </section>

      <section>
        <Card className="bg-muted/40">
          <CardHeader>
            <CardTitle>자동화를 직접 설정하기 어려우신가요?</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              전문 구축 서비스로 사업 정보만 알려주시면 자동화 설정을 대신 해드립니다.
            </p>
            <Button asChild variant="outline">
              <Link href="/pricing#setup-service">구축 대행 알아보기</Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
