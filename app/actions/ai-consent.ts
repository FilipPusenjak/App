"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

/**
 * Allow or withdraw sending this account's data to the AI provider.
 *
 * Only ever the signed-in account's own row — there is no parameter naming a
 * user, so a counselor cannot grant it on a student's behalf by construction.
 * Granting again keeps the original date: "when did they first agree" is the
 * useful answer, and a second click on an already-allowed panel is not news.
 */
export async function setAiConsentAction(allow: boolean): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user?.id) return { ok: false };

  if (allow) {
    await prisma.user.updateMany({
      where: { id: user.id, aiConsentAt: null },
      data: { aiConsentAt: new Date() },
    });
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: { aiConsentAt: null },
    });
  }

  revalidatePath("/", "layout");
  return { ok: true };
}
