import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  // Already signed in? Skip the form. /start knows which of the two products
  // this account belongs to; this page deliberately does not.
  if (await getCurrentUser()) redirect("/start");

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Welcome back</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Sign in to your account. Students and counselors use the same door —
        you land in the right place.
      </p>
      <LoginForm />
    </div>
  );
}
