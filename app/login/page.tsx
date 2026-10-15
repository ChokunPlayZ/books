"use client";
import { useState } from "react";
import type { FormEvent } from "react";
import Icon from "../../components/Icon";
import LibraryBrand from "../../components/LibraryBrand";
import LibraryArtwork from "../../components/LibraryArtwork";
import ThemeToggle from "../../components/ThemeToggle";
export default function LoginPage() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: new FormData(event.currentTarget).get("password"),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      window.location.assign("/");
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Sign in failed. Try again.",
      );
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-story">
        <div className="login-header">
          <LibraryBrand />
          <ThemeToggle />
        </div>
        <div className="login-story-copy">
          <p className="eyebrow">A home for every story</p>
          <h2>
            A little order.
            <br />A lot of stories.
          </h2>
          <p>
            For the series you love, the volumes you’re missing, and the next
            book you can’t wait to open.
          </p>
          <LibraryArtwork />
        </div>
        <span className="login-story-foot">One volume at a time.</span>
      </section>
      <section className="login">
        <span className="data-icon">
          <Icon name="book" />
        </span>
        <p className="eyebrow">Welcome to your shelf</p>
        <h1>Open your library</h1>
        <p className="intro">
          Your next chapter is waiting. Make yourself at home.
        </p>
        <form className="grid" onSubmit={submit}>
          <label htmlFor="password">
            Library password
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              autoFocus
              placeholder="Enter your library password"
              disabled={busy}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "loginError" : undefined}
            />
          </label>
          {error && (
            <p id="loginError" role="alert" className="form-error">
              {error}
            </p>
          )}
          <button className="btn primary" disabled={busy}>
            <Icon name="lock" />
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="login-note">
          <Icon name="lock" />
          Your personal collection, in your own space.
        </p>
      </section>
    </main>
  );
}
