export const THEME_STORAGE_KEY = "books-theme";

// Apply the saved preference before the browser paints the page.
export const THEME_INIT_SCRIPT = `(() => {
  let theme;
  try { theme = localStorage.getItem("${THEME_STORAGE_KEY}"); } catch {}
  document.documentElement.dataset.theme =
    theme === "light" || theme === "dark"
      ? theme
      : matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
})();`;
