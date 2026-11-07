import type { Metadata } from "next";
import ExternalLink from "../../../components/ExternalLink";

export const metadata: Metadata = {
  title: "Privacy Policy · meemai",
  description:
    "How CKLabs handles meemai account, book collection, and purchase data.",
};

export default function PrivacyPage() {
  return (
    <article>
      <h1>Privacy Policy</h1>
      <p className="legal-updated">
        Last updated: <time dateTime="2026-11-07">7 November 2026</time>
      </p>
      <p className="legal-intro">
        CKLabs operates meemai, a free book collection service, and is
        responsible for the personal data handled through the service. This
        policy explains what we collect, why we use it, and when it may be
        shared.
      </p>

      <section aria-labelledby="information-collected">
        <h2 id="information-collected">1. Information we collect</h2>
        <ul>
          <li>
            <strong>Account information:</strong> your verified Google email
            address, Google account identifier, and account and sign-in records.
            Google sign-in requests only OpenID and email access, not access to
            Gmail, Drive, or Contacts. meemai does not receive your Google
            password.
          </li>
          <li>
            <strong>Book and purchase information:</strong> the books you enter
            or import, including titles, ISBNs, volumes, publishers, reading
            status, notes, and other collection details. Purchase records
            include the store or source where a book was bought, when it was
            bought, and how much you paid, where you provide those details.
          </li>
          <li>
            <strong>Preferences and service records:</strong> language and theme
            choices, saved releases, removed-book records, and records needed
            for imports, updates, and account security.
          </li>
          <li>
            <strong>Connection information:</strong> when you access the site,
            the hosting and delivery services may process your IP address,
            browser information, request details, and security logs to deliver
            and protect the service.
          </li>
        </ul>
      </section>

      <section aria-labelledby="how-information-is-used">
        <h2 id="how-information-is-used">2. How we use information</h2>
        <p>
          We use your information to create and secure your account, save and
          display your library, track purchases and reading, produce collection
          statistics, support imports and exports, remember preferences, and
          maintain and troubleshoot meemai. CKLabs and its authorized service
          administrators may access information as needed for these purposes.
        </p>
        <p>
          Where applicable under Thailand’s Personal Data Protection Act (PDPA),
          processing relies on providing the service you request, legitimate
          interests such as service security where those interests do not
          override your rights, legal obligations, or consent where required.
        </p>
      </section>

      <section aria-labelledby="publisher-sharing">
        <h2 id="publisher-sharing">3. Sharing with book publishers</h2>
        <p>
          CKLabs may share users’ book and purchase data with book publishers if
          a publisher requests it. This may include which books you have, the
          store where you bought them, purchase dates, and amounts paid. Do not
          assume that these records will never be disclosed to a publisher.
        </p>
        <p>
          Any sharing must comply with applicable law and have an appropriate
          lawful basis. A publisher’s request alone does not override your data
          protection rights. Where separate consent is required, CKLabs must
          obtain it before sharing; using meemai or accepting its terms does not
          by itself provide that consent.
        </p>
      </section>

      <section aria-labelledby="storage-and-providers">
        <h2 id="storage-and-providers">
          4. Storage location and service providers
        </h2>
        <p>
          meemai’s application data, including your stored account, book, and
          purchase records, is stored entirely in Thailand. The exceptions are
          processing associated with Google OAuth sign-in and the content
          delivery network (CDN) operated by Cloudflare, Inc., where applicable.
          These providers may process relevant data outside Thailand.
        </p>
        <ul>
          <li>
            <strong>Google:</strong> handles OAuth authentication and related
            identity and connection data under its own{" "}
            <ExternalLink href="https://policies.google.com/privacy">
              Privacy Policy
            </ExternalLink>
            .
          </li>
          <li>
            <strong>Cloudflare, Inc.:</strong> where used to deliver and protect
            the site, may process traffic passing through its network, including
            IP addresses and request information, under its{" "}
            <ExternalLink href="https://www.cloudflare.com/privacypolicy/">
              Privacy Policy
            </ExternalLink>
            . Thailand-based application storage does not mean all network
            traffic remains in Thailand.
          </li>
        </ul>
        <p>
          Book lookups and searches may send the title, ISBN, or search terms
          needed for the lookup to external book-information sources. Following
          an external shop or publisher link takes you to a service with its own
          privacy practices. External links include ref=meemai.ckl.moe in the
          destination URL to identify meemai as the traffic source. The browser
          may also send the site’s origin as a referrer, but not your private
          page path or query parameters. CKLabs may also disclose information
          where required by applicable law.
        </p>
      </section>

      <section aria-labelledby="cookies-and-storage">
        <h2 id="cookies-and-storage">5. Cookies and browser storage</h2>
        <p>
          meemai uses cookies for sign-in and session security, and browser
          storage for settings such as appearance and library filters. Account
          preferences are also saved on the server. Blocking required cookies
          may prevent sign-in. Google and Cloudflare may use their own cookies
          or similar technologies when their services are involved.
        </p>
      </section>

      <section aria-labelledby="retention-and-security">
        <h2 id="retention-and-security">6. Retention and security</h2>
        <p>
          Information is retained as needed to provide the service and for
          legitimate operational, security, and legal needs. Removed books may
          remain available for restoration; removing a book from your shelf does
          not immediately erase all related records. Backup copies may remain
          until replaced or expired under the applicable backup process.
        </p>
        <p>
          Sign-in and account access controls help protect your library from
          other users. No storage or transmission system is completely secure.
          Keep your Google account and any downloaded library exports secure.
        </p>
      </section>

      <section aria-labelledby="your-rights">
        <h2 id="your-rights">7. Your choices and rights</h2>
        <p>
          You can review and edit your library in meemai and export your
          owned-book records from Data &amp; backups. Depending on applicable
          law, you may also have rights to access, correct, delete, or obtain
          your personal data, object to or restrict processing, withdraw consent
          where processing relies on it, and complain to Thailand’s Personal
          Data Protection Committee or another competent authority.
        </p>
        <p>
          To ask about your data or exercise these rights, contact CKLabs, the
          operator of meemai, at{" "}
          <a href="mailto:chokunplayz@ckl.moe">chokunplayz@ckl.moe</a>. We may
          need to verify your identity. Some requests may be subject to legal
          exceptions; withdrawing consent does not affect processing that was
          lawful before withdrawal.
        </p>
      </section>

      <section aria-labelledby="policy-changes">
        <h2 id="policy-changes">8. Changes to this policy</h2>
        <p>
          Updates will be published on this page with a revised date. CKLabs
          will provide any additional notice or obtain consent required by law
          for changes to how personal data is used or shared. See also the{" "}
          <a href="/terms">Terms of Service</a>.
        </p>
      </section>
    </article>
  );
}
