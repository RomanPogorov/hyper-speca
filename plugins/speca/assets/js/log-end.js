// Right after the chat in the page (a parser-blocking script, so before the first paint): a chat opens at its end —
// not at the top of its history with a jump down once everything has loaded. A search result (?at=) is found by app.js.
(() => {
  const log = document.getElementById("log");
  if (!log || new URLSearchParams(location.search).has("at")) return;
  log.style.scrollBehavior = "auto"; log.scrollTop = log.scrollHeight; log.style.scrollBehavior = "";
  // shown only now, at its end (a long chat was once painted from its top, then jumped down)
  log.dataset.placed = "1";
})();
