import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
import { marked } from "https://cdn.jsdelivr.net/npm/marked@15.0.12/lib/marked.esm.js";
import DOMPurify from "https://cdn.jsdelivr.net/npm/dompurify@3.2.6/+esm";

const MARKDOWN_TAGS = [
  "p", "h1", "h2", "h3", "h4", "ul", "ol", "li", "strong", "em", "code",
  "pre", "blockquote", "a", "hr", "br", "table", "thead", "tbody", "tr", "th", "td",
];
const overview = JSON.parse(document.getElementById("overviewData").textContent);
const navigation = document.getElementById("navigation");
const panelsRoot = document.getElementById("panels");
const renderError = document.getElementById("renderError");
const buttons = [];
const panels = [];
let ready = Promise.resolve();

mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  theme: "base",
  flowchart: {
    curve: "basis",
    htmlLabels: true,
    nodeSpacing: 34,
    rankSpacing: 52,
    useMaxWidth: false,
  },
  themeVariables: {
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, sans-serif",
    fontSize: "14px",
    primaryTextColor: "#1d1d1f",
    lineColor: "#6e6e73",
    clusterBkg: "#f5f5f7",
    clusterBorder: "#d2d2d7",
  },
});

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function buildMentalModel(spec) {
  const mentalModel = element("article", "mental-model");
  mentalModel.append(element("h2", "", spec.title));
  const markdown = element("div", "mental-model-markdown");
  markdown.innerHTML = DOMPurify.sanitize(marked.parse(spec.markdown), {
    ALLOWED_TAGS: MARKDOWN_TAGS,
    ALLOWED_ATTR: ["href", "title"],
  });
  markdown.querySelectorAll("a").forEach((link) => {
    const href = link.getAttribute("href");
    if (!href) return;
    const protocol = new URL(href, window.location.href).protocol;
    if (!["http:", "https:", "mailto:"].includes(protocol)) {
      link.removeAttribute("href");
      return;
    }
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  });
  mentalModel.append(markdown);
  if (spec.points?.length) {
    const points = element("div", "mental-model-points");
    spec.points.forEach((point) => {
      const item = element("div", "mental-model-point");
      item.append(element("b", "", point.title), element("span", "", point.body));
      points.append(item);
    });
    mentalModel.append(points);
  }
  return mentalModel;
}

function buildPanel(spec, index) {
  const button = element("button", `nav-item${index === 0 ? " active" : ""}`);
  button.type = "button";
  button.dataset.panel = spec.id;
  button.append(element("b", "", spec.navTitle), element("small", "", spec.navSummary));
  navigation.append(button);
  buttons.push(button);

  const panel = element("section", `panel${index === 0 ? " active" : ""}`);
  panel.id = spec.id;
  const heading = element("div", "panel-heading");
  heading.append(element("h1", "", spec.heading), element("p", "", spec.summary));
  const diagram = element("div", "diagram");
  const source = element("pre", "mermaid", spec.mermaid);
  diagram.append(source);
  const content = element(
    "div",
    `panel-content${spec.mentalModel ? " has-mental-model" : ""}`,
  );
  if (spec.mentalModel) content.append(buildMentalModel(spec.mentalModel));
  content.append(diagram);
  panel.append(heading, content);

  panelsRoot.append(panel);
  panels.push(panel);
}

function showError(message) {
  renderError.textContent = message;
  renderError.style.display = "block";
}

async function renderPanel(panel) {
  const target = panel.querySelector(".mermaid");
  if (target.dataset.rendered === "true") return;
  const code = target.textContent.trim();
  try {
    const { svg, bindFunctions } = await mermaid.render(`diagram-${panel.id}`, code);
    target.innerHTML = svg;
    target.dataset.rendered = "true";
    bindFunctions?.(target);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    target.dataset.renderError = message;
    showError(`Diagram “${panel.id}” failed: ${message}`);
    throw error;
  }
}

async function activatePanel(index) {
  buttons.forEach((button, itemIndex) => button.classList.toggle("active", itemIndex === index));
  panels.forEach((panel, itemIndex) => panel.classList.toggle("active", itemIndex === index));
  document.querySelector("main").scrollTo({ left: 0, top: 0, behavior: "auto" });
  await renderPanel(panels[index]);
}

setText("title", overview.header.title);
setText("subtitle", overview.header.subtitle);
setText("chip", overview.header.chip);
setText("sectionLabel", overview.sidebar.label);
setText("guardrailTitle", overview.sidebar.guardrail.title);
setText("guardrailBody", overview.sidebar.guardrail.body);
document.title = overview.header.title;
overview.panels.forEach(buildPanel);
buttons.forEach((button, index) => {
  button.addEventListener("click", () => activatePanel(index).catch(() => undefined));
});

ready = activatePanel(0);
window.branchOverview = { verify, ready, inspectLayout, verification: null };

async function runAutomaticVerification() {
  const status = document.getElementById("verificationStatus");
  try {
    const report = await verify();
    window.branchOverview.verification = report;
    status.textContent = report.ok
      ? "Verified"
      : `${report.failed.length} panel${report.failed.length === 1 ? "" : "s"} need attention`;
    status.classList.add(report.ok ? "verified" : "failed");
    status.title = report.ok
      ? `All ${report.panels.length} panels passed runtime verification.`
      : `Failed panels: ${report.failed.map((panel) => panel.id).join(", ")}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    status.textContent = "Verification failed";
    status.classList.add("failed");
    status.title = message;
    showError(`Runtime verification failed: ${message}`);
  }
}

queueMicrotask(() => void runAutomaticVerification());
