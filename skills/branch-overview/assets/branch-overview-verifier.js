function afterLayout() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function documentFitsViewport() {
  const tolerance = 1;
  return document.documentElement.scrollWidth <= window.innerWidth + tolerance &&
    document.documentElement.scrollHeight <= window.innerHeight + tolerance;
}

function inspectScrollableBounds(diagram, svg) {
  const style = getComputedStyle(diagram);
  const scrollable = ["auto", "scroll"].includes(style.overflowX) &&
    ["auto", "scroll"].includes(style.overflowY);
  diagram.scrollTo({ left: 0, top: 0, behavior: "auto" });
  const diagramRect = diagram.getBoundingClientRect();
  const svgRect = svg?.getBoundingClientRect();
  const contentStartVisible = !svg || (
    svgRect.top >= diagramRect.top + Number.parseFloat(style.paddingTop) - 1 &&
    svgRect.left >= diagramRect.left + Number.parseFloat(style.paddingLeft) - 1
  );
  const maximumLeft = diagram.scrollWidth - diagram.clientWidth;
  const maximumTop = diagram.scrollHeight - diagram.clientHeight;
  diagram.scrollTo({ left: maximumLeft, top: maximumTop, behavior: "auto" });
  const contentEndReachable = diagram.scrollLeft >= maximumLeft - 1 &&
    diagram.scrollTop >= maximumTop - 1;
  diagram.scrollTo({ left: 0, top: 0, behavior: "auto" });
  return { scrollable, contentStartVisible, contentEndReachable };
}

function inspectMainScrollBounds() {
  const main = document.querySelector("main");
  const style = getComputedStyle(main);
  const mainScrollableHorizontally = ["auto", "scroll"].includes(style.overflowX);
  const maximumLeft = main.scrollWidth - main.clientWidth;
  main.scrollTo({ left: 0, top: main.scrollTop, behavior: "auto" });
  const mainContentStartReachable = main.scrollLeft <= 1;
  main.scrollTo({ left: maximumLeft, top: main.scrollTop, behavior: "auto" });
  const mainContentEndReachable = main.scrollLeft >= maximumLeft - 1;
  main.scrollTo({ left: 0, top: main.scrollTop, behavior: "auto" });
  return {
    mainScrollableHorizontally,
    mainHorizontalOverflowRequired: window.innerWidth <= 1100,
    mainHasHorizontalOverflow: maximumLeft > 1,
    mainContentStartReachable,
    mainContentEndReachable,
    mainMaximumScrollLeftPx: Math.max(0, Math.round(maximumLeft)),
    mainFitsVertically: main.scrollHeight <= main.clientHeight + 1,
  };
}

function inspectLayout() {
  const tolerance = 1;
  const appRect = document.querySelector(".app")?.getBoundingClientRect();
  const main = document.querySelector("main");
  const mainStyle = main && getComputedStyle(main);
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    documentFitsViewport: documentFitsViewport(),
    appFillsViewport: Boolean(appRect) &&
      Math.abs(appRect.left) <= tolerance &&
      Math.abs(appRect.top) <= tolerance &&
      Math.abs(appRect.right - window.innerWidth) <= tolerance &&
      Math.abs(appRect.bottom - window.innerHeight) <= tolerance,
    mainScrollableHorizontally: Boolean(mainStyle) &&
      ["auto", "scroll"].includes(mainStyle.overflowX),
    mainHasHorizontalOverflow: Boolean(main) && main.scrollWidth > main.clientWidth + 1,
    mainFitsVertically: Boolean(main) && main.scrollHeight <= main.clientHeight + 1,
  };
}

async function verify() {
  await ready.catch(() => undefined);
  const results = [];
  for (let index = 0; index < panels.length; index += 1) {
    const panel = panels[index];
    let error = null;
    try {
      await activatePanel(index);
      await afterLayout();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    const diagram = panel.querySelector(".diagram");
    const mentalModelExpected = Boolean(overview.panels[index].mentalModel);
    const mentalModelRendered = !mentalModelExpected || Boolean(panel.querySelector(".mental-model"));
    const target = panel.querySelector(".mermaid");
    const svg = target.querySelector("svg");
    const scrollBounds = inspectScrollableBounds(diagram, svg);
    const mainScrollBounds = inspectMainScrollBounds();
    results.push({
      id: panel.id,
      active: panel.classList.contains("active"),
      rendered: target.dataset.rendered === "true",
      svg: Boolean(svg),
      mentalModelRendered,
      documentFitsViewport: documentFitsViewport(),
      ...scrollBounds,
      ...mainScrollBounds,
      error: error ?? target.dataset.renderError ?? null,
    });
  }
  await activatePanel(0).catch(() => undefined);
  panels[0]?.querySelectorAll(".mental-model, .diagram").forEach((element) => {
    element.scrollTo({ left: 0, top: 0, behavior: "auto" });
  });
  const failed = results.filter(
    (result) =>
      !result.active || !result.rendered || !result.svg || !result.mentalModelRendered ||
      !result.documentFitsViewport ||
      !result.scrollable || !result.contentStartVisible || !result.contentEndReachable ||
      !result.mainScrollableHorizontally ||
      (result.mainHorizontalOverflowRequired && !result.mainHasHorizontalOverflow) ||
      !result.mainContentStartReachable || !result.mainContentEndReachable ||
      !result.mainFitsVertically || result.error,
  );
  const layout = inspectLayout();
  return {
    ok: failed.length === 0 && layout.documentFitsViewport &&
      layout.appFillsViewport && layout.mainScrollableHorizontally &&
      layout.mainFitsVertically,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    layout,
    panels: results,
    failed,
  };
}
