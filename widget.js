"use strict";

const CONFIG = Object.freeze({
  catalogUrl: "./models/catalog.json",
  wixSiteBasePath: "/fingerprint/",
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
  viewResult: document.querySelector("#view-result"),
  errorPanel: document.querySelector("#error-panel"),
  errorMessage: document.querySelector("#error-message"),
  retryButton: document.querySelector("#retry-button"),
};

let model = null;
let wixSlugs = Object.create(null);
let initializationRun = 0;
let classificationRun = 0;
let dragDepth = 0;

function setUploadEnabled(enabled) {
  elements.imageInput.disabled = !enabled;
  elements.dropZone.classList.toggle("is-disabled", !enabled);
}

function setBusy(isBusy) {
  elements.loadingOverlay.hidden = !isBusy;
  elements.widgetCard.setAttribute("aria-busy", String(isBusy));
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
  elements.viewResult.removeAttribute("href");
  elements.viewResult.hidden = true;
}

function showResult(label, resultUrl) {
  elements.resultLabel.textContent = label;
  elements.viewResult.hidden = !resultUrl;

  if (resultUrl) {
    elements.viewResult.href = resultUrl;
  } else {
    elements.viewResult.removeAttribute("href");
  }

  elements.dropZone.hidden = true;
  elements.resultPanel.hidden = false;
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
  setBusy(false);
  setUploadEnabled(false);
  showUpload();
  clearError();

  const alias = new URLSearchParams(window.location.search).get("model")?.trim();
  if (!alias) {
    showError("This widget needs a model link.");
    return;
  }

  if (alias.length > 64 || !ALIAS_PATTERN.test(alias)) {
    showError("This model link is not valid.");
    return;
  }

  try {
    const catalog = await fetchCatalog();
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
  }
}

function validateImage(file) {
  if (!file) {
    throw new Error("Choose an image to continue.");
  }

  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Choose a PNG, JPEG, WebP, GIF, or BMP image.");
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error("Choose an image smaller than 15 MB.");
  }
}

function loadImage(file) {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();

  return new Promise((resolve, reject) => {
    image.addEventListener("load", () => resolve({ image, objectUrl }), { once: true });
    image.addEventListener(
      "error",
      () => {
        URL.revokeObjectURL(objectUrl);
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

function getSafeResultUrl(label) {
  const wixSiteBaseUrl = getWixSiteBaseUrl();
  const slug = wixSlugs[label];
  if (!wixSiteBaseUrl || !slug) {
    return null;
  }

  return new URL(slug, wixSiteBaseUrl).href;
}

async function classify(file) {
  const thisRun = ++classificationRun;
  let loadedImage;
  clearError();
  setBusy(true);
  setUploadEnabled(false);
  elements.resultPanel.hidden = true;

  try {
    validateImage(file);
    if (!model) {
      throw new Error("The classifier is still loading. Try again in a moment.");
    }

    loadedImage = await loadImage(file);
    const predictions = await model.predict(loadedImage.image, false);

    if (thisRun !== classificationRun) {
      return;
    }

    if (!Array.isArray(predictions) || predictions.length === 0) {
      throw new Error("The model returned no class predictions.");
    }

    const winner = [...predictions].sort((a, b) => b.probability - a.probability)[0];
    if (!winner || typeof winner.className !== "string" || !winner.className.trim()) {
      throw new Error("The model returned an invalid class prediction.");
    }

    showResult(winner.className, getSafeResultUrl(winner.className));
  } catch (error) {
    if (thisRun === classificationRun) {
      console.error("Prediction failed", error);
      showUpload();
      showError(
        error instanceof Error ? error.message : "Choose a different image and try again.",
      );
      setUploadEnabled(Boolean(model));
    }
  } finally {
    if (loadedImage?.objectUrl) {
      URL.revokeObjectURL(loadedImage.objectUrl);
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
  if (!model) {
    showError("This browser is offline. Reconnect and retry.", { retry: true });
  }
});

initialize();
