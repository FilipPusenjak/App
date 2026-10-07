import Link from "next/link";
import { MINIMUM_AGE_YEARS } from "@/lib/validation/age";
import {
  DEFAULT_INPUT_SNAPSHOT_DAYS,
  FREE_RESULT_DAYS,
  PAID_RESULT_DAYS,
} from "@/lib/evaluation/retention";
import { MIN_COHORT_SIZE } from "@/lib/discovery/policy";
import { privacyContact } from "@/lib/privacy-contact";

/**
 * Privacy policy.
 *
 * Same rule as app/terms: WRITTEN AGAINST THE CODE. Every window and threshold
 * is imported from the module that enforces it, and every claim about who sees
 * what was checked against the route that does it — the list of processors is
 * the list of services the app actually calls, and "what is sent to the AI" was
 * read off the snapshot builder, not assumed. If you add a processor or start
 * sending a new field to a model, this page is part of that change.
 *
 * Both app stores require a reachable privacy policy URL, and Apple's 5.1.2(i)
 * requires naming third-party AI specifically — hence its own section.
 *
 * NOT LEGAL ADVICE AND NOT LAWYER-REVIEWED.
 */
export const metadata = {
  title: "Privacy Policy — CourseChart",
};

const UPDATED = "7 October 2026";

export default function PrivacyPage() {
  const contact = privacyContact();

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-16">
      <Link
        href="/"
        className="text-sm font-medium text-zinc-500 hover:text-foreground"
      >
        ← CourseChart
      </Link>

      <h1 className="mt-6 text-3xl font-semibold tracking-tight">
        Privacy Policy
      </h1>
      <p className="mt-1 text-sm text-zinc-500">Last updated {UPDATED}.</p>

      <div className="mt-8 space-y-8 text-sm leading-6 text-zinc-700 dark:text-zinc-300">
        <Section title="The short version">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              We keep what you enter so we can show it back to you and run the
              feedback you ask for.
            </li>
            <li>
              <Strong>
                Your profile is sent to an AI provider (Anthropic) only when you
                run an evaluation, and we ask your permission before the first
                time.
              </Strong>
            </li>
            <li>We do not sell your data, show ads, or use it to train models.</li>
            <li>
              A counselor or tutor sees your data only if you invite them, and
              you can see a log of what they opened.
            </li>
            <li>
              You can export everything, and deleting your account deletes it.
            </li>
          </ul>
        </Section>

        <Section title="1. What we collect">
          <p>
            <Strong>Your account:</Strong> email address, a password (stored
            only as a one-way hash — we cannot read it), optional name and
            country, and your date of birth, which is used to check the minimum
            age.
          </p>
          <p>
            <Strong>Your profile:</Strong> what you choose to enter — school,
            grade level, curriculum, grades and test scores, activities and
            what you wrote about them, intended subject, career goal, target
            universities and plans.
          </p>
          <p>
            <Strong>What the service produces:</Strong> evaluations, check-ins,
            projections and the scores extracted from them.
          </p>
          <p>
            <Strong>Billing:</Strong> if you subscribe, Stripe handles payment.
            We store your Stripe customer and subscription identifiers and the
            plan status, never your card details.
          </p>
          <p>
            <Strong>Security records:</Strong> failed sign-in counts and
            temporary lockouts on your account, and password-reset tokens
            (stored hashed, and single-use).
          </p>
          <p>
            We do not use advertising or analytics trackers. The only cookie we
            set is the one that keeps you signed in.
          </p>
        </Section>

        <Section title="2. Third-party AI">
          <p>
            Evaluations, check-ins and projections are written by a large
            language model from Anthropic, PBC. When you run one, the following
            is sent to Anthropic&apos;s API:{" "}
            <Strong>
              your profile as described above — grades, scores, activities and
              what you wrote about them, school, subject interests and target
              universities — together with earlier evaluations of the same
              profile.
            </Strong>
          </p>
          <p>
            Your name, email address and date of birth are not sent with a
            student evaluation. Two features used by the people you invite do
            send more: a counselor&apos;s session prep includes your name and
            the notes that counselor wrote, and a tutor&apos;s progress briefing
            includes your name so it can be forwarded.
          </p>
          <p>
            <Strong>
              Nothing is sent until you agree to it in the app.
            </Strong>{" "}
            You are asked once, before your first AI feature, and you can
            withdraw that permission from your settings at any time — the AI
            features stop working for your account until you give it again.
          </p>
          <p>
            Anthropic processes this data to return the result to us. Under its
            commercial terms it does not use it to train its models, and keeps
            it only for a limited period under its own retention policy.
          </p>
        </Section>

        <Section title="3. Who else processes your data">
          <p>
            These services run parts of CourseChart for us and receive only
            what they need to do that:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <Strong>Vercel</Strong> — hosts the website and app.
            </li>
            <li>
              <Strong>Neon</Strong> — hosts the database your data is stored
              in.
            </li>
            <li>
              <Strong>Anthropic</Strong> — the AI provider, as described above.
            </li>
            <li>
              <Strong>Stripe</Strong> — payments, if you subscribe.
            </li>
            <li>
              <Strong>Resend</Strong> — sends password-reset emails, and
              reminder emails you can unsubscribe from in one click.
            </li>
          </ul>
          <p>
            These providers may process data in countries other than yours,
            including the United States.
          </p>
          <p>
            <Strong>We do not sell your data</Strong> or share it with anyone
            else, except where the law requires us to.
          </p>
        </Section>

        <Section title="4. Counselors and tutors">
          <p>
            A counselor or tutor sees a student&apos;s data only after the
            student issues an invite code and both the student and a parent or
            guardian agree. The student chooses how much they see. Either can
            end that access at any time, and it ends immediately.
          </p>
          <p>
            Every time a counselor or tutor opens a student&apos;s data, it is
            recorded, and the student can read that log in their settings.
          </p>
        </Section>

        <Section title="5. Activity Discovery">
          <p>
            If you opt in, your activities can contribute to anonymous
            summaries of what students with similar interests do. A summary is
            only shown when it covers at least {MIN_COHORT_SIZE} students, rare
            activities are left out, and counts are shown as ranges, so no one
            can be picked out of it. You can opt out at any time and you stop
            being counted straight away.
          </p>
        </Section>

        <Section title="6. How long we keep it">
          <p>
            Your account and profile are kept until you delete them. To hold
            less about you over time, older evaluation data is deleted on a
            schedule:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              The copy of your profile taken at each run: after{" "}
              {DEFAULT_INPUT_SNAPSHOT_DAYS} days.
            </li>
            <li>
              The written evaluation: after {FREE_RESULT_DAYS} days on the free
              plan, {PAID_RESULT_DAYS} days on a paid plan.
            </li>
            <li>
              Scores are kept with your account so your progress chart covers
              your whole time at school.
            </li>
          </ul>
        </Section>

        <Section title="7. Your choices and rights">
          <p>
            You can see and edit everything you entered in the app,{" "}
            <Strong>export all of it</Strong> from your settings, and{" "}
            <Strong>delete your account</Strong> from your settings. Deleting
            removes your account, profiles, evaluations and scores from our
            database and cancels any subscription; it is not a hidden or
            deactivated state. Stripe keeps its own payment records as the law
            requires.
          </p>
          <p>
            Depending on where you live you may have further rights — for
            example to object to processing or to complain to a data-protection
            authority. Contact us to exercise any of them.
          </p>
        </Section>

        <Section title="8. Children">
          <p>
            CourseChart is for students aged {MINIMUM_AGE_YEARS} and over; we
            ask for a date of birth at signup and refuse accounts below that
            age. If you believe a younger child has an account, contact us and
            we will delete it.
          </p>
        </Section>

        <Section title="9. Security">
          <p>
            Data is encrypted in transit, passwords are hashed, and access to
            the production database is restricted. No system is perfectly
            secure; if a breach affects your data we will tell you.
          </p>
        </Section>

        <Section title="10. Changes">
          <p>
            If we change this policy in a way that matters — a new kind of data,
            or a new company we share it with — we will tell you in the app
            before it takes effect.
          </p>
        </Section>

        <Section title="11. Contact">
          {contact ? (
            <p>
              Questions or requests about your data:{" "}
              <a
                href={`mailto:${contact}`}
                className="font-medium text-zinc-900 underline underline-offset-2 dark:text-zinc-100"
              >
                {contact}
              </a>
              .
            </p>
          ) : (
            <p>
              Questions or requests about your data can go to the contact
              address on the CourseChart website.
            </p>
          )}
        </Section>
      </div>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Strong({ children }: { children: React.ReactNode }) {
  return (
    <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
      {children}
    </strong>
  );
}
