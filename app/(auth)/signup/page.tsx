import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { SignupForm } from "./signup-form";

export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Create your account</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Your profile is private to you.
      </p>
      <SignupForm />
    </div>
  );
}
