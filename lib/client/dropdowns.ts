type DropdownControl = HTMLSelectElement | HTMLInputElement;

// Keep the real control as the source of truth: controller updates,
// React-controlled preferences, form validation and no-JS forms still work.
export function mountDropdowns() {
  if (!("showPopover" in HTMLElement.prototype)) return;
  const events = new AbortController();
  const { signal } = events;
  let select: DropdownControl | null = null;
  let menu: HTMLDivElement | null = null;
  let options: HTMLOptionElement[] = [];
  let active = -1;
  let sequence = 0;
  let search = "";
  let searchTime = 0;
  let originalControls: string | null = null;
  let originalExpanded: string | null = null;
  let originalActive: string | null = null;
  let choosing = false;
  const inputs = new Map<
    HTMLInputElement,
    {
      list: string;
      role: string | null;
      autocomplete: string | null;
      nativeAutocomplete: string | null;
      expanded: string | null;
    }
  >();

  function enhanceInput(input: HTMLInputElement) {
    const list = input.getAttribute("list");
    if (
      !list ||
      !(document.getElementById(list) instanceof HTMLDataListElement)
    )
      return;
    const previous = inputs.get(input);
    inputs.set(
      input,
      previous
        ? { ...previous, list }
        : {
            list,
            role: input.getAttribute("role"),
            autocomplete: input.getAttribute("aria-autocomplete"),
            nativeAutocomplete: input.getAttribute("autocomplete"),
            expanded: input.getAttribute("aria-expanded"),
          },
    );
    // Retain the server's datalist for no-JS entry, but suppress its native
    // popup once the shared, keyboard-accessible suggestions are available.
    input.removeAttribute("list");
    input.setAttribute("role", "combobox");
    input.setAttribute("autocomplete", "off");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
  }

  function enhanceInputs(root: ParentNode) {
    if (root instanceof HTMLInputElement) enhanceInput(root);
    root
      .querySelectorAll<HTMLInputElement>("input[list]")
      .forEach(enhanceInput);
  }

  enhanceInputs(document);
  const inputObserver = new MutationObserver((records) => {
    for (const record of records) {
      if (
        record.type === "attributes" &&
        record.target instanceof HTMLInputElement
      )
        enhanceInput(record.target);
      for (const node of record.addedNodes)
        if (node instanceof Element) enhanceInputs(node);
    }
  });
  inputObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["list"],
  });

  function trigger(target: EventTarget | null) {
    if (
      target instanceof HTMLInputElement &&
      inputs.has(target) &&
      !target.matches(":disabled")
    )
      return target;
    return target instanceof HTMLSelectElement &&
      !target.multiple &&
      target.size <= 1 &&
      !target.matches(":disabled")
      ? target
      : null;
  }

  function available(option: HTMLOptionElement) {
    const group = option.parentElement;
    return (
      !option.disabled &&
      !option.hidden &&
      !(
        group instanceof HTMLOptGroupElement &&
        (group.disabled || group.hidden)
      )
    );
  }

  function restore(name: string, value: string | null) {
    if (value === null) select?.removeAttribute(name);
    else select?.setAttribute(name, value);
  }

  function close() {
    observer.disconnect();
    restore("aria-controls", originalControls);
    restore("aria-expanded", originalExpanded);
    restore("aria-activedescendant", originalActive);
    menu?.remove();
    select = null;
    menu = null;
    options = [];
    active = -1;
    search = "";
  }

  function highlight(index: number, scroll = true) {
    if (!menu || !options[index] || !available(options[index])) return;
    active = index;
    for (const item of menu.querySelectorAll<HTMLElement>("[role=option]")) {
      const current = Number(item.dataset.optionIndex) === index;
      item.toggleAttribute("data-active", current);
      if (current) {
        select?.setAttribute("aria-activedescendant", item.id);
        if (scroll) {
          // Only scroll the menu, never the page or a book-entry dialog.
          const top = item.offsetTop;
          const bottom = top + item.offsetHeight;
          if (top < menu.scrollTop) menu.scrollTop = top;
          else if (bottom > menu.scrollTop + menu.clientHeight)
            menu.scrollTop = bottom - menu.clientHeight;
        }
      }
    }
  }

  function position() {
    if (!select || !menu) return;
    if (!select.isConnected || !select.checkVisibility()) {
      close();
      return;
    }
    const rect = select.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const gap = 6;
    const gutter = 8;
    if (
      rect.bottom < top + gutter ||
      rect.top > top + height - gutter ||
      rect.right < left ||
      rect.left > left + width
    ) {
      close();
      return;
    }
    menu.style.width = `${Math.min(Math.max(rect.width, 220), width - gutter * 2)}px`;
    const below = top + height - rect.bottom - gap - gutter;
    const above = rect.top - top - gap - gutter;
    const upwards = below < Math.min(240, menu.scrollHeight) && above > below;
    menu.style.maxHeight = `${Math.max(0, Math.min(320, upwards ? above : below))}px`;
    menu.style.left = `${Math.max(left + gutter, Math.min(rect.left, left + width - menu.offsetWidth - gutter))}px`;
    menu.style.top = `${upwards ? rect.top - menu.offsetHeight - gap : rect.bottom + gap}px`;
  }

  function label() {
    if (!select || !menu) return;
    const labelledBy = select.getAttribute("aria-labelledby");
    if (labelledBy) menu.setAttribute("aria-labelledby", labelledBy);
    else {
      const text = Array.from(select.labels ?? [], (element) => {
        const copy = element.cloneNode(true) as HTMLElement;
        copy
          .querySelectorAll("select, input, textarea, button, .hint")
          .forEach((control) => control.remove());
        return copy.textContent?.trim();
      }).join(" ");
      menu.setAttribute(
        "aria-label",
        select.getAttribute("aria-label") || text,
      );
    }
  }

  function render() {
    if (!select || !menu) return;
    if (!trigger(select)) {
      close();
      return;
    }
    if (select instanceof HTMLSelectElement)
      options = Array.from(select.options);
    else {
      const list = document.getElementById(inputs.get(select)?.list ?? "");
      const query = select.value.trim().toLocaleLowerCase();
      options =
        list instanceof HTMLDataListElement
          ? Array.from(list.options)
              .filter(
                (option) =>
                  option.value.toLocaleLowerCase().includes(query) ||
                  option.label.toLocaleLowerCase().includes(query),
              )
              .slice(0, 100)
          : [];
      if (!options.length) {
        close();
        return;
      }
    }
    menu.replaceChildren();
    let previousGroup: HTMLElement | null = null;
    let container: HTMLElement = menu;
    options.forEach((option, index) => {
      const group = option.parentElement;
      if (option.hidden || group?.hidden) return;
      if (group !== previousGroup) {
        previousGroup = group;
        container = menu!;
        if (group instanceof HTMLOptGroupElement) {
          container = document.createElement("div");
          container.setAttribute("role", "group");
          container.setAttribute("aria-label", group.label);
          const heading = document.createElement("div");
          heading.className = "dropdown-group";
          heading.textContent = group.label;
          heading.setAttribute("aria-hidden", "true");
          container.append(heading);
          menu!.append(container);
        }
      }
      const item = document.createElement("div");
      item.className = "dropdown-option";
      item.id = `${menu!.id}-option-${index}`;
      item.dataset.optionIndex = String(index);
      item.setAttribute("role", "option");
      item.setAttribute(
        "aria-selected",
        String(
          select instanceof HTMLSelectElement
            ? option.selected
            : select?.value === option.value,
        ),
      );
      item.setAttribute("aria-disabled", String(!available(option)));
      item.textContent = option.label || option.value;
      if (option.lang) item.lang = option.lang;
      container.append(item);
    });
    label();
    position();
    select?.removeAttribute("aria-activedescendant");
    const index =
      options[active] && available(options[active])
        ? active
        : select instanceof HTMLSelectElement
          ? select.selectedIndex
          : -1;
    active = -1;
    highlight(index ?? -1);
    if (active < 0 && select instanceof HTMLSelectElement)
      highlight(options.findIndex(available));
  }

  const observer = new MutationObserver(render);

  function open(control: DropdownControl) {
    close();
    select = control;
    originalControls = control.getAttribute("aria-controls");
    originalExpanded = control.getAttribute("aria-expanded");
    originalActive = control.getAttribute("aria-activedescendant");
    active = control instanceof HTMLSelectElement ? control.selectedIndex : -1;
    menu = document.createElement("div");
    menu.id = `dropdown-${++sequence}`;
    menu.className = "dropdown-menu";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("popover", "manual");
    // A modal dialog makes nodes outside it inert; keep its popup inside it,
    // then use the top layer so the scrolling dialog cannot clip the menu.
    (control.closest("dialog") ?? document.body).append(menu);
    menu.showPopover();
    control.setAttribute("aria-controls", menu.id);
    control.setAttribute("aria-expanded", "true");
    control.focus({ preventScroll: true });
    render();
    if (!menu) return;
    observer.observe(control, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["disabled", "hidden", "label", "selected", "value"],
    });
    if (control instanceof HTMLInputElement) {
      const list = document.getElementById(inputs.get(control)?.list ?? "");
      if (list)
        observer.observe(list, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ["disabled", "hidden", "label", "value"],
        });
    }
  }

  function choose(index = active) {
    const control = select;
    if (!control || !options[index] || !available(options[index])) return;
    const value = options[index].value;
    const changed =
      control instanceof HTMLSelectElement
        ? control.selectedIndex !== index
        : control.value !== value;
    close();
    if (changed) {
      if (control instanceof HTMLSelectElement) control.selectedIndex = index;
      else control.value = value;
      choosing = true;
      try {
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.dispatchEvent(new Event("change", { bubbles: true }));
      } finally {
        choosing = false;
      }
    }
  }

  function move(direction: number) {
    let index =
      active < 0 && direction < 0 ? options.length - 1 : active + direction;
    while (index >= 0 && index < options.length) {
      if (available(options[index])) {
        highlight(index);
        return;
      }
      index += direction;
    }
  }

  function typeahead(key: string) {
    const now = Date.now();
    search = now - searchTime > 700 ? key : search + key;
    searchTime = now;
    const repeated = Array.from(search).every((letter) => letter === key);
    const query = (repeated ? key : search).toLocaleLowerCase();
    const start = active + (repeated ? 1 : 0);
    for (let offset = 0; offset < options.length; offset++) {
      const index = (start + offset + options.length) % options.length;
      if (
        available(options[index]) &&
        options[index].label.trim().toLocaleLowerCase().startsWith(query)
      ) {
        highlight(index);
        break;
      }
    }
  }

  document.addEventListener(
    "pointerdown",
    (event) => {
      const control = trigger(event.target);
      if (control && event.button === 0) {
        if (control instanceof HTMLSelectElement) {
          event.preventDefault();
          control.focus({ preventScroll: true });
        }
      } else if (menu && !menu.contains(event.target as Node)) close();
    },
    { capture: true, signal },
  );
  document.addEventListener(
    "mousedown",
    (event) => {
      if (
        event.button === 0 &&
        (trigger(event.target) instanceof HTMLSelectElement ||
          menu?.contains(event.target as Node))
      )
        event.preventDefault();
    },
    { capture: true, signal },
  );
  document.addEventListener(
    "click",
    (event) => {
      const control = trigger(event.target);
      if (control) {
        if (control instanceof HTMLSelectElement) {
          event.preventDefault();
          if (control === select) close();
          else open(control);
        } else if (control !== select) open(control);
      } else if (menu && event.target instanceof Element) {
        const item = event.target.closest<HTMLElement>("[data-option-index]");
        if (item && menu.contains(item)) {
          // Do not let a menu inside a form or wrapping label submit/reopen it.
          event.preventDefault();
          event.stopPropagation();
          choose(Number(item.dataset.optionIndex));
        }
      }
    },
    { capture: true, signal },
  );
  document.addEventListener(
    "pointermove",
    (event) => {
      if (
        !menu ||
        event.pointerType === "touch" ||
        !(event.target instanceof Element)
      )
        return;
      const item = event.target.closest<HTMLElement>("[data-option-index]");
      if (item && menu.contains(item))
        highlight(Number(item.dataset.optionIndex), false);
    },
    { signal },
  );
  document.addEventListener(
    "keydown",
    (event) => {
      const control = trigger(event.target);
      if (!control || event.isComposing) return;
      const opened = control === select;
      if (event.key === "Tab") {
        if (opened) {
          if (control instanceof HTMLSelectElement) choose();
          close();
        }
        return;
      }
      if (event.key === "Escape") {
        if (!opened) return;
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }
      if (control instanceof HTMLInputElement) {
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (event.key === "Enter") {
          if (!opened || active < 0) return;
          event.preventDefault();
          event.stopPropagation();
          choose();
          return;
        }
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        event.stopPropagation();
        if (!opened) open(control);
        move(event.key === "ArrowDown" ? 1 : -1);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key !== "ArrowDown") return;
      const printable =
        event.key.length === 1 &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey;
      if (
        !["ArrowDown", "ArrowUp", "Home", "End", "Enter", " ", "F4"].includes(
          event.key,
        ) &&
        !printable
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      if (!opened) open(control);
      switch (event.key) {
        case "ArrowDown":
          if (opened) move(1);
          break;
        case "ArrowUp":
          if (opened && event.altKey) choose();
          else if (opened) move(-1);
          break;
        case "Home":
          highlight(options.findIndex(available));
          break;
        case "End":
          highlight(
            options.reduce(
              (last, option, index) => (available(option) ? index : last),
              -1,
            ),
          );
          break;
        case "Enter":
        case " ":
        case "F4":
          if (opened) choose();
          break;
        default:
          typeahead(event.key);
      }
    },
    { capture: true, signal },
  );
  document.addEventListener(
    "input",
    (event) => {
      const control = trigger(event.target);
      if (
        !(control instanceof HTMLInputElement) ||
        choosing ||
        (event instanceof InputEvent && event.isComposing)
      )
        return;
      if (control !== select) open(control);
      else {
        active = -1;
        render();
      }
    },
    { signal },
  );
  document.addEventListener(
    "focusin",
    (event) => {
      if (
        select &&
        event.target !== select &&
        !menu?.contains(event.target as Node)
      )
        close();
    },
    { signal },
  );
  document.addEventListener(
    "change",
    (event) => {
      if (event.target === select) close();
    },
    { signal },
  );
  document.addEventListener(
    "close",
    (event) => {
      if (select?.closest("dialog") === event.target) close();
    },
    { capture: true, signal },
  );
  document.addEventListener(
    "scroll",
    (event) => {
      if (menu && !menu.contains(event.target as Node)) position();
    },
    { capture: true, passive: true, signal },
  );
  window.addEventListener("resize", position, { signal });
  window.visualViewport?.addEventListener("resize", position, { signal });
  window.visualViewport?.addEventListener("scroll", position, { signal });
  return () => {
    events.abort();
    inputObserver.disconnect();
    close();
    for (const [input, original] of inputs) {
      input.setAttribute("list", original.list);
      for (const [attribute, value] of [
        ["role", original.role],
        ["aria-autocomplete", original.autocomplete],
        ["autocomplete", original.nativeAutocomplete],
        ["aria-expanded", original.expanded],
      ]) {
        if (value === null) input.removeAttribute(attribute!);
        else input.setAttribute(attribute!, value!);
      }
    }
    inputs.clear();
  };
}
