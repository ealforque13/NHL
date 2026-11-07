
/* HOIST OFFICIAL
   Automatic Today Calendar Indicator */

(function () {
  "use strict";

  const calendarId = "v2-calendar";

  function localDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function markToday() {
    const calendar = document.getElementById(calendarId);

    if (!calendar) return;

    const today = new Date();
    const todayKey = localDateKey(today);

    calendar
      .querySelectorAll(".hoist-today")
      .forEach(el => el.classList.remove("hoist-today"));

    const dateCells = calendar.querySelectorAll(
      ".v2-day, [data-date]"
    );

    dateCells.forEach(cell => {
      const dateValue =
        cell.getAttribute("data-date") ||
        cell.getAttribute("data-day");

      if (!dateValue) return;

      if (dateValue.slice(0, 10) === todayKey) {
        cell.classList.add("hoist-today");
      }
    });
  }

  function initialize() {
    const calendar = document.getElementById(calendarId);

    if (!calendar) return;

    const observer = new MutationObserver(markToday);

    observer.observe(calendar, {
      childList: true,
      subtree: true
    });

    markToday();
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      initialize
    );
  } else {
    initialize();
  }
})();
