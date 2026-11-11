"use client";

import { useEffect, useRef, useState } from "react";
import { createSuggestionClient } from "../../lib/client/search-suggestions.ts";
import {
  canSuggest,
  type SearchSuggestion,
} from "../../lib/domain/search-suggestions.ts";
import { useTranslations } from "../PreferencesProvider";

async function rpc(name: string, arg: unknown, signal: AbortSignal) {
  const response = await fetch("/api/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arg }),
    signal,
  });
  if (!response.ok) throw new Error("Query suggestions unavailable.");
  return response.json();
}

export default function SearchQueryInput({
  query,
  onChange,
  error,
  searching,
}: {
  query: string;
  onChange: (value: string) => void;
  error: string;
  searching: boolean;
}) {
  const t = useTranslations();
  const client = useRef<ReturnType<typeof createSuggestionClient> | null>(null);
  if (!client.current) client.current = createSuggestionClient(rpc);
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const active = suggestions.findIndex((item) => item.value === activeValue);
  const menu = useRef<HTMLUListElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const enabled =
    focused &&
    !composing &&
    !searching &&
    dismissed !== query &&
    canSuggest(query);
  const open = enabled && suggestions.length > 0;

  useEffect(() => {
    setActiveValue(null);
    setSuggestions(enabled ? client.current!.cached(query) : []);
    if (!enabled) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void client.current!.run({
        query,
        signal: controller.signal,
        onSuggestions: (items) => {
          // A cached replay or late provider may reorder the list while the
          // user is navigating. Keep the chosen name, never its old position.
          setActiveValue((value) =>
            items.some((item) => item.value === value) ? value : null,
          );
          setSuggestions(items);
        },
      });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, query]);

  // Keyboard updates scroll only the list, not the page or the virtual keyboard.
  useEffect(() => {
    const list = menu.current;
    const option = list?.children[active] as HTMLElement | undefined;
    if (!list || !option) return;
    if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
    else if (
      option.offsetTop + option.offsetHeight >
      list.scrollTop + list.clientHeight
    )
      list.scrollTop =
        option.offsetTop + option.offsetHeight - list.clientHeight;
  }, [active]);

  useEffect(() => {
    if (!open) return;
    const position = () => {
      const rect = input.current?.getBoundingClientRect();
      const viewport = window.visualViewport;
      if (rect && menu.current)
        menu.current.style.maxHeight =
          Math.max(
            0,
            Math.min(
              320,
              (viewport ? viewport.height + viewport.offsetTop : innerHeight) -
                rect.bottom -
                16,
            ),
          ) + "px";
    };
    position();
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    window.addEventListener("resize", position);
    return () => {
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      window.removeEventListener("resize", position);
    };
  }, [open]);

  const choose = (item: SearchSuggestion) => {
    onChange(item.value);
    setDismissed(item.value);
    setActiveValue(null);
  };
  return (
    <div className="field">
      <label htmlFor="universalSearchQuery">
        {t("Title, publisher or ISBN")}
      </label>
      <input
        ref={input}
        id="universalSearchQuery"
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? "universalSearchSuggestions" : undefined}
        aria-activedescendant={
          open && active >= 0 && active < suggestions.length
            ? "searchSuggestion-" + active
            : undefined
        }
        value={query}
        maxLength={200}
        placeholder={t("Search Thai, English or Japanese titles…")}
        enterKeyHint="search"
        autoComplete="off"
        aria-describedby={
          error
            ? "universalSearchHint universalSearchError"
            : "universalSearchHint"
        }
        aria-invalid={!!error}
        onFocus={() => {
          setFocused(true);
          setDismissed(null);
        }}
        onBlur={() => {
          setFocused(false);
          setDismissed(query);
        }}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={() => setComposing(false)}
        onChange={(event) => {
          setDismissed(null);
          setActiveValue(null);
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (
            event.nativeEvent.isComposing ||
            composing ||
            event.keyCode === 229
          )
            return;
          if (event.key === "Escape") {
            event.preventDefault();
            setDismissed(query);
            setActiveValue(null);
          } else if (open && ["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            setActiveValue((value) => {
              const index = suggestions.findIndex(
                (item) => item.value === value,
              );
              const next =
                event.key === "ArrowDown"
                  ? (index + 1) % suggestions.length
                  : (index <= 0 ? suggestions.length : index) - 1;
              return suggestions[next].value;
            });
          } else if (event.key === "Enter") {
            if (open && active >= 0 && suggestions[active]) {
              event.preventDefault();
              choose(suggestions[active]);
            } else setDismissed(query);
          } else if (event.key === "Tab") setDismissed(query);
        }}
      />
      {open && (
        <ul
          ref={menu}
          id="universalSearchSuggestions"
          role="listbox"
          aria-label={t("Search suggestions")}
          className="search-suggestions"
        >
          {suggestions.map((item, index) => (
            <li
              key={item.value}
              id={"searchSuggestion-" + index}
              role="option"
              aria-selected={active === index}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(item)}
              onPointerMove={(event) => {
                if (event.pointerType === "mouse") setActiveValue(item.value);
              }}
            >
              <span>{item.value}</span>
              <small>{t(item.label)}</small>
            </li>
          ))}
        </ul>
      )}
      <span className="sr-only" role="status">
        {open
          ? t("{count} search suggestions available.", {
              count: suggestions.length,
            })
          : ""}
      </span>
    </div>
  );
}
