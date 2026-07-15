type ThemePreference = "auto" | "light" | "dark";
type ResolvedTheme = Exclude<ThemePreference, "auto">;

const storageKey = "starlight-theme";
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const themeOrder: ThemePreference[] = ["auto", "light", "dark"];

function labelTheme(preference: ThemePreference) {
  return preference === "auto" ? "System" : preference[0].toUpperCase() + preference.slice(1);
}

function nextTheme(preference: ThemePreference) {
  return themeOrder[(themeOrder.indexOf(preference) + 1) % themeOrder.length];
}

function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored === "light" || stored === "dark" ? stored : "auto";
  } catch {
    return "auto";
  }
}

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "auto" ? (systemTheme.matches ? "dark" : "light") : preference;
}

function applyTheme(preference: ThemePreference) {
  const resolved = resolveTheme(preference);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.style.colorScheme = resolved;
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.setAttribute("content", resolved === "dark" ? "#171d26" : "#f6f8fb");
  });
  document.querySelectorAll<HTMLImageElement>("[data-theme-image]").forEach((image) => {
    const source = resolved === "dark" ? image.dataset.darkSrc : image.dataset.lightSrc;
    if (source && image.getAttribute("src") !== source) image.setAttribute("src", source);
  });
  const nextPreference = nextTheme(preference);
  document.querySelectorAll<HTMLButtonElement>("[data-theme-control]").forEach((control) => {
    control.dataset.themePreference = preference;
    control.title = `Appearance: ${labelTheme(preference)} · Switch to ${labelTheme(nextPreference)}`;
    control.setAttribute("aria-label", `Appearance: ${labelTheme(preference)}. Switch to ${labelTheme(nextPreference)}.`);
  });
  document.querySelectorAll<HTMLElement>("[data-theme-label]").forEach((label) => { label.textContent = labelTheme(preference); });
}

function storeTheme(preference: ThemePreference) {
  try { window.localStorage.setItem(storageKey, preference === "auto" ? "" : preference); }
  catch { /* The theme still applies when storage is unavailable. */ }
}

function bindThemeControls() {
  applyTheme(readPreference());
  document.querySelectorAll<HTMLButtonElement>("[data-theme-control]").forEach((control) => {
    if (control.dataset.themeBound) return;
    control.dataset.themeBound = "true";
    control.addEventListener("click", () => {
      const preference = nextTheme(readPreference());
      storeTheme(preference);
      applyTheme(preference);
    });
  });
}

bindThemeControls();
systemTheme.addEventListener("change", () => { if (readPreference() === "auto") applyTheme("auto"); });
window.addEventListener("storage", (event) => { if (event.key === storageKey) applyTheme(readPreference()); });
