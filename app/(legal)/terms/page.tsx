import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service · meemai",
  description:
    "Terms for using meemai, a free book collection service by CKLabs.",
};

export default function TermsPage() {
  return (
    <article>
      <h1>Terms of Service</h1>
      <p className="legal-updated">
        Last updated: <time dateTime="2026-11-07">7 November 2026</time>
      </p>
      <p className="legal-intro">
        meemai is a book collection service operated by CKLabs and provided free
        of charge to users. These terms govern your use of the service.
      </p>

      <section aria-labelledby="using-meemai">
        <h2 id="using-meemai">1. Using meemai</h2>
        <p>
          By using meemai, you agree to these terms. If you do not agree, do not
          use the service. You must be legally able to agree to these terms, or
          have any permission required from a parent or guardian.
        </p>
        <p>
          CKLabs does not charge you to use meemai. Any books you buy,
          third-party services you use, and your internet access are separate
          from this free service.
        </p>
      </section>

      <section aria-labelledby="your-account">
        <h2 id="your-account">2. Your account</h2>
        <p>
          meemai uses Google sign-in. Keep your Google account secure and use
          only an account you are authorized to use. You are responsible for
          your activity on meemai and for the information you choose to enter or
          import.
        </p>
      </section>

      <section aria-labelledby="your-data">
        <h2 id="your-data">3. Your books and data</h2>
        <p>
          You retain any rights you have in the information you submit. You
          authorize CKLabs to store and process that information to provide the
          service, as described in the <a href="/privacy">Privacy Policy</a>.
          Only submit information you have the right to provide.
        </p>
        <p>
          Your library may include book details, reading status, notes, the
          store where you bought a book, the purchase date, and the amount paid.
          The Privacy Policy explains how this information is handled, including
          possible sharing with book publishers on request. Agreement to these
          terms does not replace any separate consent required by law.
        </p>
      </section>

      <section aria-labelledby="acceptable-use">
        <h2 id="acceptable-use">4. Acceptable use</h2>
        <p>
          Do not use meemai unlawfully, infringe other people’s rights, access
          another user’s account or data without authorization, upload malicious
          content, bypass security controls, or disrupt the service. Do not use
          or attempt to use our servers to disrupt, overload, or otherwise harm
          upstream services, including publishers, shops, authentication
          providers, or other services meemai connects to. This includes
          exploiting bugs, security vulnerabilities, or similar weaknesses.
        </p>
        <p>
          CKLabs reserves the right to restrict, suspend, or terminate any
          account that abuses the service or attempts any of these activities,
          including attempted disruption of upstream services through our
          servers. CKLabs may also take action to address security risks or
          comply with legal requirements, subject to applicable law.
        </p>
      </section>

      <section aria-labelledby="third-party-information">
        <h2 id="third-party-information">5. Third-party information</h2>
        <p>
          Book details, cover images, release dates, availability, and prices
          may come from publishers, shops, or other sources. They may be
          incomplete, outdated, or incorrect. Check information with the
          relevant seller before buying. Third-party websites and services have
          their own terms and privacy policies; meemai is not the seller of the
          books listed.
        </p>
      </section>

      <section aria-labelledby="availability">
        <h2 id="availability">6. Availability and responsibility</h2>
        <p>
          meemai is provided on an “as is” and “as available” basis to the
          extent permitted by law. CKLabs does not guarantee uninterrupted
          service, error-free information, or that data will never be lost. Keep
          your own exports of important library records using Data &amp;
          backups.
        </p>
        <p>
          To the extent permitted by law, CKLabs is not responsible for indirect
          or consequential losses arising from use of, or inability to use, the
          service. Nothing in these terms excludes liability or consumer rights
          that cannot legally be excluded.
        </p>
      </section>

      <section aria-labelledby="changes-and-leaving">
        <h2 id="changes-and-leaving">7. Changes and leaving the service</h2>
        <p>
          You may stop using meemai at any time and export your owned-book
          records from Data &amp; backups. For account or data-deletion
          requests, contact CKLabs at{" "}
          <a href="mailto:chokunplayz@ckl.moe">chokunplayz@ckl.moe</a>. Removing
          a book from your shelf is not the same as deleting your account or all
          retained records.
        </p>
        <p>
          CKLabs may change, suspend, or discontinue the service and may update
          these terms. Updated terms will be posted here with a revised date.
          Any notice or consent required by applicable law will still be
          required.
        </p>
      </section>

      <section aria-labelledby="law-and-questions">
        <h2 id="law-and-questions">8. Applicable law and questions</h2>
        <p>
          These terms are governed by the laws of Thailand, without limiting any
          mandatory protections that apply to you. For questions about these
          terms or the service, contact CKLabs, the operator of meemai, at{" "}
          <a href="mailto:chokunplayz@ckl.moe">chokunplayz@ckl.moe</a>.
        </p>
      </section>
    </article>
  );
}
