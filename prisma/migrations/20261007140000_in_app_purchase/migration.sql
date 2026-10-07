-- In-app purchases from the native apps. See Subscription.provider and
-- User.iapAccountToken.
ALTER TABLE "Subscription" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'STRIPE';

-- Existing access-code grants are the only rows Stripe never sold. They are
-- recognisable by the synthetic id lib/billing/codes.ts gives them.
UPDATE "Subscription" SET "provider" = 'COMP' WHERE "stripeSubscriptionId" LIKE 'comp\_%';

ALTER TABLE "User" ADD COLUMN "iapAccountToken" TEXT;
CREATE UNIQUE INDEX "User_iapAccountToken_key" ON "User"("iapAccountToken");
