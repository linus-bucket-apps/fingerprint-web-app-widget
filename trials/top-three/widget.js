"use strict";

const CONFIG = Object.freeze({
  catalogUrl: "./models/catalog.json",
  wixSiteBasePath: "/fingerprint/",
  unidentifiedMinProbability: 0.5,
  unidentifiedMinLead: 0.15,
  tensorflowUrl:
    "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@1.3.1/dist/tf.min.js",
  teachableMachineUrl:
    "https://cdn.jsdelivr.net/npm/@teachablemachine/image@0.8.3/dist/teachablemachine-image.min.js",
});

const ALIAS_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_IMAGE_SIZE_BYTES = 15 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/bmp",
]);

const elements = {
  widgetCard: document.querySelector(".widget-card"),
  dropZone: document.querySelector("#drop-zone"),
  imageInput: document.querySelector("#image-input"),
  loadingOverlay: document.querySelector("#loading-overlay"),
  resultPanel: document.querySelector("#result-panel"),
  resultLabel: document.querySelector("#result-label"),
  chartTitle: document.querySelector("#chart-title"),
  previewImage: document.querySelector("#preview-image"),
  uncertaintyMessage: document.querySelector("#uncertainty-message"),
  loadingMessage: document.querySelector("#loading-message"),
  demoBanner: document.querySelector("#demo-banner"),
  resultList: document.querySelector("#result-list"),
  resultHint: document.querySelector("#result-hint"),
  anotherImage: document.querySelector("#another-image"),
  errorPanel: document.querySelector("#error-panel"),
  errorMessage: document.querySelector("#error-message"),
  retryButton: document.querySelector("#retry-button"),
};

let model = null;
let wixSlugs = Object.create(null);
let initializationRun = 0;
let classificationRun = 0;
let dragDepth = 0;
let activeModelAlias = null;
let previewScenario = null;
let selectedObjectUrl = null;
const ownedObjectUrls = new Set();

const PREVIEW_SCENARIOS = Object.freeze({
  clear: [0.76, 0.14, 0.06, 0.04, 0, 0, 0, 0],
  close: [0.48, 0.46, 0.03, 0.03, 0, 0, 0, 0],
  diffuse: [0.125, 0.125, 0.125, 0.125, 0.125, 0.125, 0.125, 0.125],
  "two-class": [0.68, 0.32],
});

function getPreviewScenario() {
  const value = new URLSearchParams(window.location.search).get("preview");
  return Object.hasOwn(PREVIEW_SCENARIOS, value) ? value : null;
}

function getRankedPredictions(predictions) {
  if (!Array.isArray(predictions) || predictions.length === 0) {
    throw new Error("The model returned no class predictions.");
  }
  const seen = new Set();
  const ranked = predictions.map((prediction) => {
    if (!prediction || typeof prediction.className !== "string" ||
        !Object.hasOwn(wixSlugs, prediction.className) || seen.has(prediction.className) ||
        !Number.isFinite(prediction.probability) || prediction.probability < 0 ||
        prediction.probability > 1) {
      throw new Error("The model returned an invalid class prediction.");
    }
    seen.add(prediction.className);
    return { className: prediction.className, slug: wixSlugs[prediction.className],
      probability: prediction.probability };
  });
  return ranked.sort((a, b) => b.probability - a.probability).slice(0, 3);
}

function formatProbability(probability) {
  return probability > 0 && probability < 0.001 ? "<0.1%" : `${(probability * 100).toFixed(1)}%`;
}

function isUnidentified(predictions) {
  const first = predictions[0]?.probability ?? 0;
  const second = predictions[1]?.probability ?? 0;
  // Decimal probabilities can put an exact 0.15 lead slightly below its boundary.
  const tolerance = Number.EPSILON * 4;
  return first + tolerance < CONFIG.unidentifiedMinProbability ||
    first - second + tolerance < CONFIG.unidentifiedMinLead;
}

function setUploadEnabled(enabled) {
  elements.imageInput.disabled = !enabled;
  elements.dropZone.classList.toggle("is-disabled", !enabled);
}

function setBusy(isBusy, message = "Analyzing your fingerprint…") {
  elements.loadingOverlay.hidden = !isBusy;
  elements.loadingMessage.textContent = isBusy ? message : "";
  elements.widgetCard.setAttribute("aria-busy", String(isBusy));
}

function releaseSelectedImage() {
  elements.previewImage.removeAttribute("src");
  revokeImageUrl(selectedObjectUrl);
  selectedObjectUrl = null;
}

function revokeImageUrl(objectUrl) {
  if (!ownedObjectUrls.delete(objectUrl)) return;
  URL.revokeObjectURL(objectUrl);
}

function showError(message, { retry = false } = {}) {
  elements.errorMessage.textContent = message;
  elements.retryButton.hidden = !retry;
  elements.errorPanel.hidden = false;
}

function clearError() {
  elements.errorPanel.hidden = true;
  elements.errorMessage.textContent = "";
  elements.retryButton.hidden = true;
}

function showUpload() {
  elements.dropZone.hidden = false;
  elements.resultPanel.hidden = true;
  elements.resultList.replaceChildren();
  elements.resultList.hidden = true;
  elements.uncertaintyMessage.hidden = true;
  elements.uncertaintyMessage.textContent = "";
  elements.resultHint.hidden = true;
  elements.anotherImage.hidden = true;
}

function showResults(predictions) {
  const unidentified = isUnidentified(predictions);
  const sampleDestinations = usesSampleDestinations();
  elements.resultLabel.textContent = unidentified ? "Unidentified image" : "Top matches";
  elements.chartTitle.textContent = unidentified ? "No confident match" : `Top ${predictions.length} predictions`;
  elements.resultPanel.setAttribute("data-state", unidentified ? "unidentified" : "identified");
  elements.uncertaintyMessage.hidden = !unidentified;
  elements.uncertaintyMessage.textContent = unidentified
    ? "Unidentified image. Try a clearer fingerprint image."
    : "";
  elements.dropZone.hidden = true;
  elements.resultPanel.hidden = false;
  elements.resultList.replaceChildren();
  elements.resultList.hidden = unidentified;
  elements.resultHint.hidden = true;
  elements.resultHint.textContent = "";
  elements.anotherImage.hidden = false;
  if (unidentified) return;
  let hasNavigation = false;
  for (const prediction of predictions) {
    const item = document.createElement("li");
    item.className = "prediction-row";
    const info = document.createElement("div");
    info.className = "prediction-info";
    const heading = document.createElement("div");
    heading.className = "prediction-heading";
    const name = document.createElement("span");
    name.className = "prediction-name";
    name.textContent = prediction.className;
    name.title = prediction.className;
    const probability = document.createElement("span");
    probability.className = "prediction-probability";
    probability.textContent = formatProbability(prediction.probability);
    heading.append(name, probability);

    const track = document.createElement("div");
    track.className = "prediction-track";
    track.setAttribute("role", "meter");
    track.setAttribute("aria-label", `${prediction.className} model probability`);
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "1");
    track.setAttribute("aria-valuenow", String(prediction.probability));
    track.setAttribute("aria-valuetext", formatProbability(prediction.probability));
    const fill = document.createElement("span");
    fill.className = "prediction-fill";
    fill.style.width = `${prediction.probability * 100}%`;
    track.append(fill);
    info.append(heading, track);

    const destination = getSafeCategoryUrl(prediction.slug);
    const link = document.createElement(destination ? "a" : "span");
    link.className = destination ? "prediction-link" : "prediction-link is-unavailable";
    link.textContent = "→";
    if (destination) {
      hasNavigation = true;
      link.href = destination;
      link.target = sampleDestinations ? "_self" : "_blank";
      if (!sampleDestinations) link.rel = "noopener";
      link.setAttribute("aria-label", sampleDestinations
        ? `Sample destination: ${prediction.className}` : `Learn about ${prediction.className} (opens in a new tab)`);
      link.title = sampleDestinations ? `Preview the ${prediction.className} sample page` : `Learn about ${prediction.className} (opens in a new tab)`;
    } else {
      link.setAttribute("role", "link");
      link.setAttribute("aria-disabled", "true");
      link.setAttribute("aria-label", `${prediction.className}: navigation requires the published Wix site`);
      link.title = "Open this widget from your published Wix site to enable navigation";
    }
    item.append(info, link);
    elements.resultList.append(item);
  }
  elements.resultList.hidden = false;
  elements.resultHint.hidden = hasNavigation && !sampleDestinations;
  elements.resultHint.textContent = sampleDestinations
    ? "Sample destinations: each arrow opens a local preview of a fingerprint type page."
    : "Type-page links appear when this widget is embedded on the configured Wix site.";
}

function resetClassification() {
  if (previewScenario) {
    const destination = new URL(window.location.href);
    destination.searchParams.delete("preview");
    destination.searchParams.set("model", activeModelAlias);
    window.location.assign(destination.href);
    return;
  }
  classificationRun += 1;
  releaseSelectedImage();
  clearError();
  setBusy(false);
  showUpload();
  setUploadEnabled(Boolean(model));
}

function loadScript(src) {
  const existing = document.querySelector(`script[src="${src}"]`);
  if (existing?.dataset.loaded === "true") {
    return Promise.resolve();
  }

  existing?.remove();

  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.addEventListener(
      "load",
      () => {
        script.dataset.loaded = "true";
        resolve();
      },
      { once: true },
    );
    script.addEventListener(
      "error",
      () => {
        script.remove();
        reject(new Error(`Could not load ${new URL(src).hostname}.`));
      },
      { once: true },
    );
    document.head.append(script);
  });
}

async function fetchCatalog() {
  const response = await fetch(CONFIG.catalogUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`The model catalog returned HTTP ${response.status}.`);
  }

  const catalog = await response.json();
  if (!catalog || Array.isArray(catalog) || typeof catalog !== "object") {
    throw new Error("The model catalog has an unexpected format.");
  }

  return catalog;
}

function getSafeWixSlugs(entry) {
  if (
    !entry.wixSlugs ||
    Array.isArray(entry.wixSlugs) ||
    typeof entry.wixSlugs !== "object"
  ) {
    throw new Error("The selected model does not define Wix result slugs.");
  }

  const safeSlugs = Object.create(null);
  const usedSlugs = new Set();

  for (const [label, slug] of Object.entries(entry.wixSlugs)) {
    if (
      !label.trim() ||
      typeof slug !== "string" ||
      slug.length > 64 ||
      !ALIAS_PATTERN.test(slug) ||
      usedSlugs.has(slug)
    ) {
      throw new Error("The selected model has invalid Wix result slugs.");
    }

    safeSlugs[label] = slug;
    usedSlugs.add(slug);
  }

  if (usedSlugs.size === 0) {
    throw new Error("The selected model does not define Wix result slugs.");
  }

  return safeSlugs;
}

function getSafeModelConfig(catalog, alias) {
  const entry = catalog[alias];
  if (!entry || typeof entry.path !== "string") {
    return null;
  }

  const catalogUrl = new URL(CONFIG.catalogUrl, window.location.href);
  const modelBase = new URL(entry.path, window.location.href);
  const modelsRoot = new URL("./models/", window.location.href);

  if (
    modelBase.origin !== window.location.origin ||
    !modelBase.pathname.startsWith(modelsRoot.pathname) ||
    !modelBase.pathname.endsWith("/") ||
    modelBase.username ||
    modelBase.password ||
    catalogUrl.origin !== window.location.origin
  ) {
    throw new Error("The selected model path is not allowed.");
  }

  return {
    modelBase,
    wixSlugs: getSafeWixSlugs(entry),
  };
}

async function loadModel(modelBase) {
  await loadScript(CONFIG.tensorflowUrl);
  await loadScript(CONFIG.teachableMachineUrl);

  if (!window.tmImage?.load) {
    throw new Error("The Teachable Machine image library did not start correctly.");
  }

  return window.tmImage.load(
    new URL("model.json", modelBase).href,
    new URL("metadata.json", modelBase).href,
  );
}

function describeLoadError(error) {
  if (!navigator.onLine) {
    return "This browser is offline. Reconnect and retry.";
  }

  const detail = error instanceof Error ? error.message : "Unknown error";
  return `The classifier could not be loaded. ${detail}`;
}

async function initialize() {
  const thisRun = ++initializationRun;
  classificationRun += 1;
  model = null;
  wixSlugs = Object.create(null);
  releaseSelectedImage();
  setUploadEnabled(false);
  showUpload();
  clearError();
  previewScenario = getPreviewScenario();
  elements.demoBanner.hidden = !previewScenario;

  if (previewScenario) {
    activeModelAlias = previewScenario === "two-class" ? "demo-a" : "demo-b";
    const labels = previewScenario === "two-class"
      ? ["Parallel Lines", "Concentric Circles"]
      : ["Plain arch", "Ulnar loop", "Plain whorl", "Tented arch",
        "Accidental whorl", "Central pocket loop", "Double loop", "Radial loop"];
    wixSlugs = Object.fromEntries(labels.map((label) => [label,
      label.toLowerCase().replaceAll(" ", "-")]));
    elements.demoBanner.textContent = "Sample preview";
    elements.previewImage.src = "./preview/fingerprint.svg";
    elements.previewImage.alt = "Illustrative fingerprint used for this design preview";
    setBusy(false);
    showResults(getRankedPredictions(labels.map((className, index) => ({
      className, probability: PREVIEW_SCENARIOS[previewScenario][index],
    }))));
    return;
  }

  setBusy(false);

  const alias = new URLSearchParams(window.location.search).get("model")?.trim();
  activeModelAlias = alias || null;
  if (!alias) {
    showError("This widget needs a model link.");
    return;
  }

  if (alias.length > 64 || !ALIAS_PATTERN.test(alias)) {
    showError("This model link is not valid.");
    return;
  }

  setBusy(true, "Loading the fingerprint classifier…");
  try {
    const catalog = await fetchCatalog();
    if (thisRun !== initializationRun) return;
    const modelConfig = getSafeModelConfig(catalog, alias);

    if (!modelConfig) {
      showError("This model is not available.");
      return;
    }

    const loadedModel = await loadModel(modelConfig.modelBase);
    if (thisRun !== initializationRun) {
      return;
    }

    model = loadedModel;
    wixSlugs = modelConfig.wixSlugs;
    setUploadEnabled(true);
  } catch (error) {
    if (thisRun !== initializationRun) {
      return;
    }

    console.error("Classifier setup failed", error);
    showError(describeLoadError(error), { retry: true });
  } finally {
    if (thisRun === initializationRun) setBusy(false);
  }
}

function validateImage(file) {
  if (!file) {
    throw new Error("Choose an image to continue.");
  }

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Choose a PNG, JPEG, WebP, GIF, or BMP image.");
  }

  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new Error("Choose an image that is not empty.");
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error("Choose an image smaller than 15 MB.");
  }
}

function loadImage(file) {
  const objectUrl = URL.createObjectURL(file);
  ownedObjectUrls.add(objectUrl);
  selectedObjectUrl = objectUrl;
  const image = new Image();

  return new Promise((resolve, reject) => {
    image.addEventListener("load", () => resolve({ image, objectUrl }), { once: true });
    image.addEventListener(
      "error",
      () => {
        revokeImageUrl(objectUrl);
        if (selectedObjectUrl === objectUrl) selectedObjectUrl = null;
        reject(new Error("The selected image could not be decoded."));
      },
      { once: true },
    );
    image.src = objectUrl;
  });
}

function getWixSiteBaseUrl() {
  if (!document.referrer) {
    return null;
  }

  try {
    const referrer = new URL(document.referrer);
    if (
      referrer.protocol !== "https:" ||
      !referrer.hostname.endsWith(".wixsite.com") ||
      referrer.username ||
      referrer.password
    ) {
      return null;
    }

    return new URL(CONFIG.wixSiteBasePath, referrer.origin);
  } catch {
    return null;
  }
}

function getSafeCategoryUrl(slug) {
  if (typeof slug !== "string" || slug.length > 64 || !ALIAS_PATTERN.test(slug) ||
      !Object.values(wixSlugs).includes(slug)) {
    return null;
  }
  if (usesSampleDestinations()) {
    const url = new URL("./preview/category.html", window.location.href);
    url.searchParams.set("type", slug);
    return url.href;
  }
  const wixSiteBaseUrl = getWixSiteBaseUrl();
  if (!wixSiteBaseUrl) {
    return null;
  }
  return new URL(slug, wixSiteBaseUrl).href;
}

function usesSampleDestinations() {
  if (previewScenario) return true;
  const location = window.location;
  return ["http:", "https:"].includes(location.protocol) &&
    ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) &&
    !getWixSiteBaseUrl();
}

async function classify(file) {
  if (previewScenario) return;
  const thisRun = ++classificationRun;
  let loadedImage;
  releaseSelectedImage();
  clearError();
  setBusy(true);
  setUploadEnabled(false);
  elements.resultPanel.hidden = true;

  try {
    validateImage(file);
    if (!model) {
      throw new Error("The classifier is still loading. Try again in a moment.");
    }

    const predictionModel = model;
    loadedImage = await loadImage(file);
    if (thisRun !== classificationRun) return;
    const predictions = await predictionModel.predict(loadedImage.image, false);

    if (thisRun !== classificationRun) {
      return;
    }

    const ranked = getRankedPredictions(predictions);
    if (loadedImage.objectUrl) {
      elements.previewImage.src = loadedImage.objectUrl;
      elements.previewImage.alt = "Uploaded fingerprint being compared with the model predictions";
    }
    showResults(ranked);
  } catch (error) {
    if (thisRun === classificationRun) {
      console.error("Prediction failed", error);
      releaseSelectedImage();
      showUpload();
      showError(
        error instanceof Error ? error.message : "Choose a different image and try again.",
      );
      setUploadEnabled(Boolean(model));
    }
  } finally {
    if (loadedImage?.objectUrl && thisRun !== classificationRun) {
      revokeImageUrl(loadedImage.objectUrl);
    }
    if (thisRun === classificationRun) {
      setBusy(false);
    }
  }
}

function handleInputChange(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (file) {
    classify(file);
  }
}

function hasFiles(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

elements.imageInput.addEventListener("change", handleInputChange);
elements.retryButton.addEventListener("click", initialize);
elements.anotherImage.addEventListener("click", resetClassification);

elements.dropZone.addEventListener("dragenter", (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  if (elements.imageInput.disabled) return;
  dragDepth += 1;
  elements.dropZone.classList.add("is-dragging");
});

elements.dropZone.addEventListener("dragover", (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = elements.imageInput.disabled ? "none" : "copy";
});

elements.dropZone.addEventListener("dragleave", (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) elements.dropZone.classList.remove("is-dragging");
});

elements.dropZone.addEventListener("drop", (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  elements.dropZone.classList.remove("is-dragging");
  if (elements.imageInput.disabled) return;
  classify(event.dataTransfer.files?.[0]);
});

window.addEventListener("offline", () => {
  if (!model && !previewScenario) {
    showError("This browser is offline. Reconnect and retry.", { retry: true });
  }
});

initialize();
