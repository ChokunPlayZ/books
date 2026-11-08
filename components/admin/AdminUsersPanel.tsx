"use client";

import { useEffect, useRef, useState } from "react";
import type {
  AdminUsers,
  AdminUser,
  AdminLibrary,
} from "../../lib/admin-users.ts";
import { useTranslations } from "../PreferencesProvider";
import { adminRpc } from "./rpc.ts";

export default function AdminUsersPanel() {
  const t = useTranslations();
  const [users, setUsers] = useState<AdminUsers | null>(null);
  const [query, setQuery] = useState({ search: "", page: 1 });
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const selectedId = useRef<number | null>(null);
  const [library, setLibrary] = useState<AdminLibrary | null>(null);
  const [libraryQuery, setLibraryQuery] = useState({
    resource: "books",
    search: "",
    page: 1,
  });
  const [invitation, setInvitation] = useState<{
    url: string;
    email: string;
    expiresAt: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  useEffect(() => {
    let disposed = false;
    void adminRpc<AdminUsers>("getAdminUsers", query)
      .then((data) => {
        if (!disposed) setUsers(data);
      })
      .catch((err) => {
        if (!disposed) setError(err.message);
      });
    return () => {
      disposed = true;
    };
  }, [query]);
  async function action(load: () => Promise<void>, message = "Changes saved.") {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await load();
      const next = await adminRpc<AdminUsers>("getAdminUsers", query);
      setUsers(next);
      if (selectedId.current)
        setSelected(
          next.users.find((u) => u.id === selectedId.current) ?? selected,
        );
      setNotice(message);
    } catch (err) {
      setError(err.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  function select(user: AdminUser | null) {
    selectedId.current = user?.id ?? null;
    setSelected(user);
    setLibrary(null);
    setInvitation(null);
    setNotice("");
    setError("");
    setLibraryQuery({ resource: "books", search: "", page: 1 });
  }
  async function loadLibrary(next = libraryQuery) {
    const id = selectedId.current;
    if (!id) return;
    const result = await adminRpc<AdminLibrary>("getAdminUserLibrary", {
      userId: id,
      confirmed: true,
      ...next,
    });
    if (selectedId.current === id) {
      setLibraryQuery(next);
      setLibrary(result);
    }
  }
  function manage(kind: string, value?: string) {
    if (
      !selected ||
      !window.confirm(
        t("Apply this account change? Access changes will sign this user out."),
      )
    )
      return;
    void action(async () => {
      await adminRpc("manageAdminUser", {
        userId: selected.id,
        action: kind,
        value,
      });
      setInvitation(null);
    });
  }
  return (
    <section aria-labelledby="adminUsersHeading">
      <h2 id="adminUsersHeading">{t("Manage users")}</h2>
      <p>
        {t(
          "Account details do not load private libraries. Opening a library requires confirmation and is recorded in the audit log.",
        )}
      </p>
      {error && (
        <p className="admin-error" role="alert">
          {t(error)}
        </p>
      )}
      {notice && (
        <p className="admin-notice" role="status">
          {t(notice)}
        </p>
      )}
      <form
        className="admin-filters"
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          select(null);
          setQuery({ search: String(form.get("search") || ""), page: 1 });
        }}
      >
        <label>
          {t("Search users")}
          <input
            type="search"
            name="search"
            placeholder={t("Name, email or account ID")}
          />
        </label>
        <button className="btn" disabled={busy}>
          {t("Search")}
        </button>
      </form>
      <details className="admin-card">
        <summary>{t("Add user")}</summary>
        <form
          className="admin-filters"
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            void action(async () => {
              await adminRpc("createAdminUser", {
                username: form.get("username"),
                email: form.get("email"),
              });
            });
          }}
        >
          <label>
            {t("Account name")}
            <input name="username" required maxLength={64} />
          </label>
          <label>
            {t("Google email")}
            <input name="email" type="email" required />
          </label>
          <button className="btn" disabled={busy}>
            {t("Create account")}
          </button>
        </form>
      </details>
      <div className="admin-table-scroll">
        <table className="admin-table">
          <caption>
            {users?.total ?? 0} {t("users matching filters")}
          </caption>
          <thead>
            <tr>
              {["Account", "Google email", "Role", "Books", "Actions"].map(
                (label) => (
                  <th key={label}>{t(label)}</th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {users?.users.map((user) => (
              <tr key={user.id}>
                <td>
                  {user.username}
                  <small>
                    #{user.id} · {t(user.disabled ? "Disabled" : "Active")}
                  </small>
                </td>
                <td>
                  {user.email || "—"}
                  <small>
                    {t(user.linked ? "Google linked" : "Not linked yet")}
                  </small>
                </td>
                <td>{user.role}</td>
                <td>{user.books}</td>
                <td>
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => select(user)}
                  >
                    {t("Manage account")}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {users && (
        <div className="admin-pager">
          <button
            className="btn"
            disabled={busy || users.page <= 1}
            onClick={() => setQuery({ ...query, page: users.page - 1 })}
          >
            {t("Previous")}
          </button>
          <span>
            {users.page} / {users.pages}
          </span>
          <button
            className="btn"
            disabled={busy || users.page >= users.pages}
            onClick={() => setQuery({ ...query, page: users.page + 1 })}
          >
            {t("Next")}
          </button>
        </div>
      )}
      {selected && (
        <section
          className="admin-card"
          aria-label={t("Account details")}
          key={selected.id}
        >
          <div className="admin-section-heading">
            <h3>
              {selected.username} · #{selected.id}
            </h3>
            <button
              className="btn"
              disabled={busy}
              onClick={() => select(null)}
            >
              {t("Close")}
            </button>
          </div>
          <p>
            {selected.email} · {selected.role} · {selected.locale} /{" "}
            {selected.theme}
          </p>
          <p>
            {t("Created")}: {selected.createdAt} · {selected.books} {t("Books")}{" "}
            · {selected.removed} {t("Removed")} · {selected.savedReleases}{" "}
            {t("Saved releases")} · {selected.catalogs}{" "}
            {t("Linked series catalogs")} · {selected.sessions}{" "}
            {t("Active sessions")}
          </p>
          <form
            className="admin-filters"
            onSubmit={(e) => {
              e.preventDefault();
              manage(
                "rename",
                String(new FormData(e.currentTarget).get("username")),
              );
            }}
          >
            <label>
              {t("Account name")}
              <input
                name="username"
                defaultValue={selected.username}
                required
                maxLength={254}
              />
            </label>
            <button className="btn" disabled={busy}>
              {t("Rename account")}
            </button>
          </form>
          <div className="admin-row-actions">
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                manage("role", selected.role === "admin" ? "user" : "admin")
              }
            >
              {t(
                selected.role === "admin" ? "Make user" : "Make administrator",
              )}
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => manage(selected.disabled ? "enable" : "disable")}
            >
              {t(selected.disabled ? "Enable account" : "Disable account")}
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => manage("revoke-sessions")}
            >
              {t("Sign out all sessions")}
            </button>
          </div>
          <h3>{t("Re-link Google account")}</h3>
          <p>
            {t(
              "Creates a single-use invitation valid for 24 hours for the destination email. The library stays intact; old sessions are revoked only after successful re-linking. Existing libraries are never merged.",
            )}
          </p>
          <form
            className="admin-filters"
            onSubmit={(e) => {
              e.preventDefault();
              const email = String(new FormData(e.currentTarget).get("email"));
              if (
                window.confirm(
                  t(
                    "Generate a re-link invitation for this account and destination email? Any previous invitation will stop working.",
                  ),
                )
              )
                void action(async () => {
                  setInvitation(
                    await adminRpc("createAccountRelink", {
                      userId: selected.id,
                      email,
                    }),
                  );
                }, "Re-link invitation created. Copy it now; it is only shown once.");
            }}
          >
            <label>
              {t("Destination Google email")}
              <input name="email" type="email" required />
            </label>
            <button className="btn" disabled={busy || selected.disabled}>
              {t("Generate re-link URL")}
            </button>
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(t("Revoke outstanding re-link invitations?"))
                )
                  void action(async () => {
                    await adminRpc("revokeAccountRelinks", {
                      userId: selected.id,
                    });
                    setInvitation(null);
                  });
              }}
            >
              {t("Revoke invitations")}
            </button>
          </form>
          {invitation && (
            <div>
              <label>
                {t("Re-link URL")}
                <input
                  className="admin-link-input"
                  value={invitation.url}
                  readOnly
                  onFocus={(e) => e.target.select()}
                />
              </label>
              <p>
                {invitation.email} · {t("Expires")}:{" "}
                {new Date(invitation.expiresAt).toLocaleString()}
              </p>
              <button
                className="btn"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(invitation.url)
                    .then(() => setNotice("Link copied."))
                    .catch(() =>
                      setError("Select and copy the link manually."),
                    );
                }}
              >
                {t("Copy link")}
              </button>
            </div>
          )}
          <h3>{t("Private library")}</h3>
          {!library ? (
            <button
              className="btn"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    t(
                      "Load this user's private library, including notes and purchase details? This access will be recorded.",
                    ),
                  )
                )
                  void action(() => loadLibrary(), "Library loaded read-only.");
              }}
            >
              {t("View library (confirmation required)")}
            </button>
          ) : (
            <>
              <button className="btn" onClick={() => setLibrary(null)}>
                {t("Hide library")}
              </button>
              <form
                className="admin-filters"
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  void action(
                    () =>
                      loadLibrary({
                        resource: String(form.get("resource")),
                        search: String(form.get("search") || ""),
                        page: 1,
                      }),
                    "",
                  );
                }}
              >
                <label>
                  {t("Library category")}
                  <select name="resource" defaultValue={libraryQuery.resource}>
                    <option value="books">
                      {t("Books (including removed)")}
                    </option>
                    <option value="saved_releases">
                      {t("Saved releases")}
                    </option>
                    <option value="series_catalogs">
                      {t("Linked series catalogs")}
                    </option>
                  </select>
                </label>
                <label>
                  {t("Search library")}
                  <input
                    name="search"
                    type="search"
                    defaultValue={libraryQuery.search}
                  />
                </label>
                <button className="btn" disabled={busy}>
                  {t("Search")}
                </button>
              </form>
              <p>
                {library.total} {t("records matching filters")}
              </p>
              <div className="admin-records">
                {library.rows.map((row, index) => (
                  <details
                    className="admin-card"
                    key={`${library.page}-${index}`}
                  >
                    <summary>
                      {String(
                        row.series || row.id || row.series_key || t("Record"),
                      )}
                      {row.removed_at ? ` · ${t("Removed")}` : ""}
                    </summary>
                    <pre>{JSON.stringify(row, null, 2)}</pre>
                  </details>
                ))}
              </div>
              <div className="admin-pager">
                <button
                  className="btn"
                  disabled={busy || library.page <= 1}
                  onClick={() =>
                    action(
                      () =>
                        loadLibrary({
                          ...libraryQuery,
                          page: library.page - 1,
                        }),
                      "",
                    )
                  }
                >
                  {t("Previous")}
                </button>
                <span>
                  {library.page} / {library.pages}
                </span>
                <button
                  className="btn"
                  disabled={busy || library.page >= library.pages}
                  onClick={() =>
                    action(
                      () =>
                        loadLibrary({
                          ...libraryQuery,
                          page: library.page + 1,
                        }),
                      "",
                    )
                  }
                >
                  {t("Next")}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </section>
  );
}
