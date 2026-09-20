export function PublicFooter() {
  return (
    <footer className="border-t py-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 text-sm text-muted-foreground">
        <p>AutoBiz — 1인 사업자와 소규모 팀을 위한 AI 업무 자동화 SaaS</p>
        <p>&copy; {new Date().getFullYear()} AutoBiz. All rights reserved.</p>
      </div>
    </footer>
  );
}
