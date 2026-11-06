import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Icon from "../../components/Icon";
import LibraryBrand from "../../components/LibraryBrand";
import ThemeToggle from "../../components/ThemeToggle";
import { googleSettings, safeReturnTo } from "../../lib/server/auth-config.ts";
import { sessionUser, SESSION_COOKIE } from "../../lib/server/auth.ts";
import { getApp } from "../../lib/server/app.ts";

export const runtime = "nodejs";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string }>;
}) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo);
  if (sessionUser(getApp().store, (await cookies()).get(SESSION_COOKIE)?.value))
    redirect(returnTo);
  let configured = true;
  try {
    googleSettings();
  } catch {
    configured = false;
  }
  return (
    <main className="login-page">
      <section className="login-story">
        <div className="login-header">
          <LibraryBrand />
          <ThemeToggle />
        </div>
      </section>
      <section className="login">
        <span className="data-icon">
          <Icon name="book" />
        </span>
        <h1>Open your library</h1>
        <p className="intro">
          Sign in with Google to manage your books. New here? Your private
          library is created automatically.
        </p>
        <form
          className="grid"
          action={"/api/auth/google?returnTo=" + encodeURIComponent(returnTo)}
          method="post"
        >
          {!configured ? (
            <p role="alert" className="form-error">
              Google sign-in is not configured yet. Contact the server
              administrator.
            </p>
          ) : params.error ? (
            <p role="alert" className="form-error">
              Google sign-in could not be completed. Please try again, or
              contact the administrator if your library needs linking.
            </p>
          ) : null}
          <button className="btn primary" type="submit" disabled={!configured}>
            <Icon name="lock" />
            Continue with Google
          </button>
        </form>
        <p className="login-note">
          <Icon name="lock" />
          Your books stay private. We only request your email address.
        </p>
      </section>
    </main>
  );
}
