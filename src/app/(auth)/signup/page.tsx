import { SignupForm } from "@/components/auth/signup-form";

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { redirectTo } = await searchParams;
  return <SignupForm redirectTo={typeof redirectTo === "string" ? redirectTo : undefined} />;
}
