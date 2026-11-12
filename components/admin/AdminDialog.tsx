"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { useTranslations } from "../PreferencesProvider";

export default function AdminDialog({
  title,
  children,
  onClose,
  returnFocus,
  busy = false,
  error = "",
  notice = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  returnFocus?: HTMLElement | null;
  busy?: boolean;
  error?: string;
  notice?: string;
}) {
  const t = useTranslations();
  const headingId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = returnFocus ?? document.activeElement;
    dialog.showModal();
    headingRef.current?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (!(opener instanceof HTMLElement) || !opener.isConnected) return;
      if (!opener.matches(":disabled")) {
        opener.focus({ preventScroll: true });
        return;
      }
      // Read-only popups can close while a request still disables their opener.
      const observer = new MutationObserver(() => {
        if (opener.matches(":disabled")) return;
        observer.disconnect();
        if (opener.isConnected && document.activeElement === document.body)
          opener.focus({ preventScroll: true });
      });
      observer.observe(opener, {
        attributes: true,
        attributeFilter: ["disabled"],
      });
    };
  }, [returnFocus]);

  return (
    <dialog
      ref={dialogRef}
      className="admin-dialog"
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="dialog-head admin-dialog-head">
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          {title}
        </h2>
        <button className="btn" type="button" disabled={busy} onClick={onClose}>
          {t("Close")}
        </button>
      </div>
      <div className="admin-dialog-body" tabIndex={0}>
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
        {children}
      </div>
    </dialog>
  );
}
