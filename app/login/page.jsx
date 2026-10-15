"use client";
import { useState } from "react";
import Icon from "../../components/Icon.jsx";
import LibraryBrand from "../../components/LibraryBrand.jsx";
import LibraryArtwork from "../../components/LibraryArtwork.jsx";
export default function LoginPage() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(event) {
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
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-story">
        <LibraryBrand />
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
        <form onSubmit={submit}>
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
