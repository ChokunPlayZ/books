"use client";
import { useState } from "react";
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
    <main className="login">
      <p className="eyebrow">A shelf of your own</p>
      <h1>Open your library</h1>
      <p className="intro">Sign in to your Book Collection.</p>
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
          />
        </label>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        <button className="btn primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
