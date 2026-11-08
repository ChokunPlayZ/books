"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { coverPlaceholderUrl } from "../../lib/domain/cover-placeholder.ts";

export default function CoverImage({
  id,
  blurhash,
  className,
  children,
}: {
  id?: string;
  blurhash?: string;
  className: string;
  children: ReactNode;
}) {
  const image = useRef<HTMLImageElement>(null);
  const [settled, setSettled] = useState<{
    id: string;
    failed: boolean;
  } | null>(null);
  const valid = /^[a-f0-9]{64}$/.test(id || "");
  const loading = valid && settled?.id !== id;
  const failed = settled?.id === id && settled?.failed;
  const placeholder = loading ? coverPlaceholderUrl(blurhash) : "";
  useEffect(() => {
    // The image may have finished before hydration attached its load listener.
    if (image.current?.complete)
      setSettled({ id, failed: !image.current.naturalWidth });
  }, [id]);
  return (
    <span
      className={className}
      aria-hidden="true"
      style={
        placeholder ? { backgroundImage: `url("${placeholder}")` } : undefined
      }
      data-cover-loading={placeholder ? "true" : undefined}
    >
      {(!valid || failed || (loading && !placeholder)) && children}
      {valid && !failed && (
        <img
          ref={image}
          src={"/api/covers/" + id}
          alt=""
          width={264}
          height={370}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setSettled({ id, failed: false })}
          onError={() => setSettled({ id, failed: true })}
        />
      )}
    </span>
  );
}
