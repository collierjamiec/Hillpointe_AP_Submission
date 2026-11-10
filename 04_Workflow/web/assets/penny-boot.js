/* Runs before the page is drawn, so the saved theme and look apply without a flash. Kept in its own file (not inline)
   so the content security policy can forbid inline scripts. */
(() => {
  "use strict";
  try { const t = localStorage.getItem("penny.theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* storage blocked */ }
  try {
    const css = localStorage.getItem("penny.appearance.css");
    if (css) { const st = document.createElement("style"); st.id = "appearance"; st.textContent = css; document.head.appendChild(st); }
  } catch (e) { /* storage blocked */ }
  try { if (sessionStorage.getItem("penny.introSeen")) document.documentElement.classList.add("intro-seen"); } catch (e) { /* storage blocked */ }
  // Forms marked data-stay never reload the page (this replaces inline onsubmit handlers).
  document.addEventListener("submit", (e) => { if (e.target.matches && e.target.matches("form[data-stay]")) e.preventDefault(); });
})();
