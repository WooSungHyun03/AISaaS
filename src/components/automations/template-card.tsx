import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import type { AutomationAvailability } from "@/types/automation";
import type { AutomationTemplate } from "@/types/domain";
import { AUTOMATION_AVAILABILITY } from "@/types/automation";

const AVAILABILITY_LABEL: Record<AutomationAvailability, string> = {
  AVAILABLE: "Available",
  BETA: "Beta",
  COMING_SOON: "Coming Soon",
};

const AVAILABILITY_VARIANT: Record<AutomationAvailability, "default" | "secondary" | "outline"> = {
  AVAILABLE: "default",
  BETA: "secondary",
  COMING_SOON: "outline",
};

export function TemplateCard({
  template,
  children,
}: {
  template: AutomationTemplate;
  children?: React.ReactNode;
}) {
  const availability = AUTOMATION_AVAILABILITY[template.slug as keyof typeof AUTOMATION_AVAILABILITY] ?? "COMING_SOON";

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">{template.name}</CardTitle>
          <Badge variant={AVAILABILITY_VARIANT[availability]}>{AVAILABILITY_LABEL[availability]}</Badge>
        </div>
        <CardDescription>{template.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
          {template.category}
        </Badge>
      </CardContent>
      {children ? <CardFooter>{children}</CardFooter> : null}
    </Card>
  );
}
