(() => {
  const root = document.documentElement;
  const darkPreference = window.matchMedia("(prefers-color-scheme: dark)");

  function storedTheme() {
    try {
      const value = localStorage.getItem("sequent-theme");
      return value === "light" || value === "dark" ? value : "system";
    } catch {
      return "system";
    }
  }

  function applyBrowserTheme() {
    const theme = storedTheme();
    if (theme === "light" || theme === "dark") root.dataset.theme = theme;
    else delete root.dataset.theme;

    const dark = theme === "dark" || (theme === "system" && darkPreference.matches);
    document
      .querySelector("#sequent-theme-color")
      ?.setAttribute("content", dark ? "#0F1214" : "#FFFEFF");
  }

  applyBrowserTheme();
  window.addEventListener("sequent-theme-change", applyBrowserTheme);
  if (darkPreference.addEventListener) darkPreference.addEventListener("change", applyBrowserTheme);
  else darkPreference.addListener(applyBrowserTheme);
})();
