// Zod schemas for auth forms. These are the single source of truth for what a
// valid email / password / name looks like, used by both the server actions and
// the Credentials provider's authorize().
import { z } from "zod";

export const loginSchema = z.object({
  email: z.email({ error: "Enter a valid email address." }),
  password: z.string().min(1, { error: "Password is required." }),
});

export const signupSchema = z.object({
  name: z.string().trim().min(1, { error: "Name is required." }).max(100),
  email: z.email({ error: "Enter a valid email address." }),
  password: z
    .string()
    .min(8, { error: "Password must be at least 8 characters." })
    .max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type SignupInput = z.infer<typeof signupSchema>;
