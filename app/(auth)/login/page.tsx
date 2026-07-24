import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  // Already signed in? Skip the form.
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Welcome back</h1>
      <p className="mb-6 text-sm text-zinc-500">Sign in to your account.</p>
      <LoginForm />
    </div>
  );
}
