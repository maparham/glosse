/**
 * Runs in the page's MAIN world at document_start. Watches the player's own
 * caption requests (/api/timedtext) and hands the response body to the
 * extension's content script via postMessage. Nothing else is touched.
 */
(() => {
  const SOURCE = "glosse";
  const isTimedText = (url: string) => url.includes("/api/timedtext");

  const announce = (url: string, body: string) => {
    window.postMessage({ source: SOURCE, type: "timedtext", url, body }, "*");
  };

  // fetch
  const origFetch = window.fetch;
  window.fetch = async function (input: RequestInfo | URL, init?: RequestInit) {
    const res = await origFetch.call(this, input, init);
    try {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (isTimedText(url)) {
        res.clone().text().then((body) => announce(url, body)).catch(() => {});
      }
    } catch {
      /* never break the page */
    }
    return res;
  };

  // XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (this: XMLHttpRequest & { __glosseUrl?: string }, method: string, url: string | URL, ...rest: unknown[]) {
    this.__glosseUrl = typeof url === "string" ? url : url.href;
    if (isTimedText(this.__glosseUrl)) {
      this.addEventListener("load", () => {
        try {
          if (typeof this.responseText === "string") announce(this.__glosseUrl!, this.responseText);
        } catch {
          /* ignore */
        }
      });
    }
    // @ts-expect-error forwarding the variadic signature
    return origOpen.call(this, method, url, ...rest);
  };
})();
