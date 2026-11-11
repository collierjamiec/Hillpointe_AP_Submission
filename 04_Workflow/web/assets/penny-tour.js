/* Penny web app: The guided tour (v2.2).
   Sections: what the tour is, the stops, showing a stop, starting and ending. */
"use strict";

// ------------------------------------------------------------------ what the tour is
/* A short walk through Penny for someone seeing it for the first time. Each stop opens a real page, outlines the part
   being described, and says in two or three sentences what it is and why it matters. The tour changes nothing: it
   only moves between pages, so it is safe for every role and in team mode.

   The card is not a modal. The page behind it stays usable, so a visitor can click around at any stop and then carry
   on. Escape ends the tour, and so does signing out. */
const TOUR = { on: false, at: 0, stops: [], lastFocus: null };

// ------------------------------------------------------------------ the stops
/** The tour's stops for the invoices on screen right now. Stops that need an invoice are left out when there is none. */
function tourStops() {
  const held = X.docs.filter(openHold).sort((a, b) => b.amount - a.amount)[0];
  const ready = X.docs.find((d) => d.pennyStatus === "ENTER_INTACCT");
  const inv = (d, tab) => `#/invoices/${encodeURIComponent(d.id)}${tab ? `?tab=${tab}` : ""}`;
  return [
    { hash: "#/", spot: ".card.attention", title: "Start with what needs you",
      text: "Penny read this week's invoices and sorted them. This card lists the ones a person has to look at, largest first. The tiles below it count everything else." },
    held && { hash: inv(held), spot: ".callout-hold", title: "Every hold says why",
      text: "Penny never just says no. It names the rule that stopped this bill, who it is routed to, and what would clear it. The invoice itself sits beside the decision." },
    held && { hash: inv(held, "read"), spot: ".pdf-panel", title: "Check Penny's reading yourself",
      text: "\"What Penny read\" lists each value Penny took from the invoice. Pick one and it is outlined on the page it came from, so you never have to take a number on trust." },
    ready && { hash: inv(ready, "coding"), spot: ".callout-ok", title: "Labels that tell the truth",
      text: "This bill passed every check. Penny says \"Ready for Intacct import\", never \"entered\" or \"paid\", because a person still uploads the file and pays the bill." },
    { hash: "#/exceptions", spot: ".exc-card", title: "One place for every kind of hold",
      text: "Each reason has its own card: what it means, who handles it, and the bills it caught. Nothing is held without a route to a person." },
    { hash: "#/exports", spot: ".export-run", title: "Files for the systems you already use",
      text: "Penny writes the Sage Intacct import file and the Entrata handoff, and records who downloaded, imported and confirmed each one. Penny prepares. People post and pay." },
    { hash: "#/rules", spot: ".rules-grid", title: "The rules are in plain view",
      text: "Thresholds, routes and keywords live in one settings file, shown here. An Admin can change one, preview what it would do to real invoices, and undo it." },
    { hash: "#/audit", spot: "table.audit", title: "Everything is on the record",
      text: "Every action is written here with who did it and when. Entries can be added. They are never edited or removed." },
    { hash: "#/help/decisions", spot: "", title: "Why it works this way",
      text: "That is the tour. The help center explains every screen, and this page gives the reason behind each choice. To see how a role changes what you can do, sign out and pick another person." },
  ].filter(Boolean);
}

// ------------------------------------------------------------------ showing a stop
/** The address of the page on screen, with the Overview always written the same way. */
const tourHere = () => (location.hash && location.hash !== "#" ? location.hash : "#/");

/** The tour card, made once and kept outside the page area so it survives moving between pages. */
function tourCard() {
  let card = $("#tour");
  if (card) return card;
  card = document.createElement("aside");
  card.id = "tour"; card.className = "tour"; card.hidden = true;
  card.setAttribute("aria-label", "Guided tour");
  card.innerHTML = `
    <div class="tour-top"><p class="tour-step" id="tour-step"></p>
      <button type="button" class="icon-btn tour-close" id="tour-end" aria-label="End the tour"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg></button></div>
    <h2 id="tour-title" tabindex="-1"></h2>
    <p class="tour-text" id="tour-text"></p>
    <div class="tour-bar" aria-hidden="true"><span id="tour-fill"></span></div>
    <div class="tour-actions"><button type="button" class="btn" id="tour-back">Back</button><button type="button" class="btn btn-accent" id="tour-next">Next</button></div>`;
  document.body.appendChild(card);
  $("#tour-end").addEventListener("click", () => endTour());
  $("#tour-back").addEventListener("click", () => tourGo(TOUR.at - 1));
  $("#tour-next").addEventListener("click", () => (TOUR.at >= TOUR.stops.length - 1 ? endTour() : tourGo(TOUR.at + 1)));
  return card;
}

/** Outline the part of the page the current stop is about, and bring it into view. */
function tourSpot() {
  $$(".tour-spot").forEach((el) => el.classList.remove("tour-spot"));
  if (!TOUR.on) return;
  const stop = TOUR.stops[TOUR.at];
  if (!stop.spot || tourHere() !== stop.hash) return;
  const el = $(stop.spot, $("#main"));
  if (!el) return;
  el.classList.add("tour-spot");
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "start", behavior: calm ? "auto" : "smooth" });   // the top of the part, below the top bar
}

/** Move to stop number i: open its page, fill in the card, and read it out. */
function tourGo(i) {
  if (!TOUR.on || !user) return endTour();
  TOUR.at = Math.max(0, Math.min(i, TOUR.stops.length - 1));
  const stop = TOUR.stops[TOUR.at], n = TOUR.stops.length, last = TOUR.at === n - 1;
  $("#tour-step").textContent = `Tour · stop ${TOUR.at + 1} of ${n}`;
  $("#tour-title").textContent = stop.title;
  $("#tour-text").textContent = stop.text;
  $("#tour-fill").style.width = `${Math.round(((TOUR.at + 1) / n) * 100)}%`;
  $("#tour-back").disabled = TOUR.at === 0;
  $("#tour-next").textContent = last ? "Finish" : "Next";
  if (tourHere() !== stop.hash) location.hash = stop.hash;
  setTimeout(() => { tourSpot(); if (TOUR.on) $("#tour-title").focus({ preventScroll: true }); }, 90);   // after the page has drawn
}

// ------------------------------------------------------------------ starting and ending
/** Start the tour at the first stop. */
function startTour() {
  if (!user || !X) return;
  const dlg = $("#dialog");
  if (dlg.open) dlg.close();
  closeUserMenu(); closeMenu();
  TOUR.stops = tourStops(); TOUR.on = true;
  TOUR.lastFocus = document.activeElement;
  tourCard().hidden = false;
  document.documentElement.classList.add("touring");
  tourGo(0);
}

/** End the tour and take its card and outline away. The page you are on stays where it is. */
function endTour() {
  if (!TOUR.on) return;
  TOUR.on = false;
  const card = $("#tour");
  if (card) card.hidden = true;
  document.documentElement.classList.remove("touring");
  tourSpot();
  const main = $("#main");
  if (user && main) main.focus({ preventScroll: true });
}

/** Wire the tour once: any "Take the tour" control starts it, Escape ends it, and a redrawn page keeps its outline. */
function bindTour() {
  document.addEventListener("click", (e) => { if (e.target.closest("[data-tour]")) { e.preventDefault(); startTour(); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && TOUR.on && !$("#dialog").open) endTour(); });
  window.addEventListener("hashchange", () => { if (TOUR.on) setTimeout(tourSpot, 90); });
}
