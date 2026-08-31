(() => {
  const api = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  let page = 1,
    pages = 1,
    sourcePage = 1;
  const load = (value) => {
    if (!Number.isInteger(value)) return;
    $("status").textContent = "Rendering local PDF…";
    api.postMessage({
      type: "page",
      page: Math.max(1, Math.min(pages, value)),
      scale: $("scale").value === "fit" ? 1.4 : Number($("scale").value),
    });
  };
  $("previous").onclick = () => load(page - 1);
  $("next").onclick = () => load(page + 1);
  $("source").onclick = () => load(sourcePage);
  $("page").onchange = () => load(Number($("page").value));
  $("scale").onchange = () => load(page);
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (data.error) {
      $("status").textContent = data.error;
      return;
    }
    page = data.page;
    pages = data.pages;
    sourcePage = data.sourcePage;
    $("page").value = page;
    $("page").max = pages;
    $("pages").textContent = "of " + pages;
    $("status").textContent = data.path;
    $("quote").textContent = data.text;
    $("quote").hidden = !data.text;
    $("previous").disabled = page <= 1;
    $("next").disabled = page >= pages;
    const fit = $("scale").value === "fit";
    $("pdf").style.maxWidth = fit ? "100%" : "none";
    $("pdf").style.width = fit ? "auto" : data.width + "px";
    $("pdf").onload = () => {
      if (data.highlight_rects.length) {
        const y =
          (data.highlight_rects[0][1] * $("pdf").clientHeight) / data.height;
        window.scrollTo({ top: Math.max(0, $("pdf").offsetTop + y - 100) });
      } else window.scrollTo(0, 0);
    };
    $("pdf").src = "data:image/png;base64," + data.image;
  });
  api.postMessage({ type: "ready" });
})();
