"use strict";

const CONFIG = Object.freeze({
  catalogUrl: "./models/catalog.json",
  topResults: 3,
  confidenceThreshold: 0.6,
  confidenceGap: 0.15,
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

const READINGS = Object.freeze({
  "plain arch": "A steady path suits this pattern. Try solving one small problem carefully before taking on the next.",
  "tented arch": "This energetic pattern suggests trying an unexpected approach—purely for fun, of course.",
  "radial loop": "A looping path can reward curiosity. Look at the problem from another angle today.",
  "ulnar loop": "This flowing pattern invites collaboration. Compare your result with a classmate's model.",
  "plain whorl": "A circular pattern calls for patient observation. Notice one detail you missed the first time.",
  "central pocket loop": "A hidden center suggests a good question is waiting. Ask why the model chose this class.",
  "double loop": "Two paths are better than one. Test a second image before drawing any conclusion.",
  "accidental whorl": "This unusual mix celebrates surprises. Treat an unexpected prediction as evidence to investigate.",
});

const elements = {
  statusPanel: document.querySelector(".status-panel"),
  statusTitle: document.querySelector("#status-title"),
  statusMessage: document.querySelector("#status-message"),
  statusBadge: document.querySelector("#status-badge"),
  retryButton: document.querySelector("#retry-button"),
  imageInput: document.querySelector("#image-input"),
  fileName: document.querySelector("#file-name"),
  previewFrame: document.querySelector("#preview-frame"),
  imagePreview: document.querySelector("#image-preview"),
  resultsPanel: document.querySelector("#results-panel"),
  predictionList: document.querySelector("#prediction-list"),
  predictionTime: document.querySelector("#prediction-time"),
  readingCard: document.querySelector("#reading-card"),
  readingTitle: document.querySelector("#reading-title"),
  readingMessage: document.querySelector("#reading-message"),
};

let model = null;
let previewObjectUrl = null;

function setStatus({ title, message, badge, tone = "quiet", retry = false }) {
  elements.statusTitle.textContent = title;
  elements.statusMessage.textContent = message;
  elements.statusBadge.textContent = badge;
  elements.statusBadge.dataset.tone = tone;
  elements.statusPanel.dataset.tone = tone;
  elements.retryButton.hidden = !retry;
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

function getSafeModelBase(catalog, alias) {
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

  return modelBase;
}

async function loadModel(modelBase) {
  await loadScript(CONFIG.tensorflowUrl);
  await loadScript(CONFIG.teachableMachineUrl);

  if (!window.tmImage?.load) {
    throw new Error("The Teachable Machine image library did not start correctly.");
  }

  const modelUrl = new URL("model.json", modelBase).href;
  const metadataUrl = new URL("metadata.json", modelBase).href;
  return window.tmImage.load(modelUrl, metadataUrl);
}

function describeLoadError(error) {
  if (!navigator.onLine) {
    return "This browser appears to be offline. Reconnect, then try again.";
  }

  const detail = error instanceof Error ? error.message : "Unknown error";
  return `The model or a required library could not be loaded. ${detail}`;
}

async function initialize() {
  model = null;
  elements.imageInput.disabled = true;
  elements.resultsPanel.hidden = true;

  const alias = new URLSearchParams(window.location.search).get("model")?.trim();

  if (!alias) {
    setStatus({
      title: "Your classifier is waiting for its trained model",
      message:
        "Add a model alias to this page's URL after the training activity to activate it.",
      badge: "No model",
      tone: "quiet",
    });
    return;
  }

  if (!ALIAS_PATTERN.test(alias)) {
    setStatus({
      title: "That model name is not valid",
      message: "Use the exact lowercase model alias supplied by the teacher.",
      badge: "Invalid",
      tone: "error",
    });
    return;
  }

  setStatus({
    title: "Loading the classroom model…",
    message: `Preparing “${alias}”. The first visit may take a few seconds.`,
    badge: "Loading",
    tone: "busy",
  });

  try {
    const catalog = await fetchCatalog();
    const modelBase = getSafeModelBase(catalog, alias);

    if (!modelBase) {
      setStatus({
        title: "This model is not available",
        message: "Check the model alias in the link or ask the teacher whether it has been published.",
        badge: "Not found",
        tone: "error",
      });
      return;
    }

    model = await loadModel(modelBase);
    elements.imageInput.disabled = false;
    setStatus({
      title: "The classifier is ready",
      message: "Choose a synthetic test image below. It stays in this browser.",
      badge: "Ready",
      tone: "ready",
    });
  } catch (error) {
    console.error("Classifier setup failed", error);
    setStatus({
      title: "The classifier could not be loaded",
      message: describeLoadError(error),
      badge: "Load error",
      tone: "error",
      retry: true,
    });
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

function loadPreview(file) {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
  }

  previewObjectUrl = URL.createObjectURL(file);
  elements.previewFrame.hidden = false;

  return new Promise((resolve, reject) => {
    elements.imagePreview.addEventListener("load", resolve, { once: true });
    elements.imagePreview.addEventListener(
      "error",
      () => reject(new Error("The selected image could not be decoded.")),
      { once: true },
    );
    elements.imagePreview.src = previewObjectUrl;
  });
}

function isUncertain(predictions) {
  const first = predictions[0]?.probability ?? 0;
  const second = predictions[1]?.probability ?? 0;
  return first < CONFIG.confidenceThreshold || first - second < CONFIG.confidenceGap;
}

function renderPredictions(predictions, elapsedMs) {
  const sorted = [...predictions].sort((a, b) => b.probability - a.probability);
  const visible = sorted.slice(0, CONFIG.topResults);
  const uncertain = isUncertain(sorted);

  elements.predictionList.replaceChildren();

  for (const prediction of visible) {
    const item = document.createElement("li");
    item.className = "prediction-row";

    const label = document.createElement("span");
    label.className = "prediction-label";
    label.textContent = prediction.className;

    const track = document.createElement("span");
    track.className = "prediction-track";
    track.setAttribute("aria-hidden", "true");

    const fill = document.createElement("span");
    fill.className = "prediction-fill";
    fill.style.width = `${Math.max(0, Math.min(100, prediction.probability * 100))}%`;
    track.append(fill);

    const score = document.createElement("span");
    score.className = "prediction-score";
    score.textContent = `${(prediction.probability * 100).toFixed(1)}%`;

    item.append(label, track, score);
    elements.predictionList.append(item);
  }

  const winner = sorted[0];
  const normalizedLabel = winner.className.trim().toLocaleLowerCase("en");
  elements.predictionTime.textContent = `${Math.round(elapsedMs)} ms`;
  elements.readingCard.dataset.uncertain = String(uncertain);

  if (uncertain) {
    elements.readingTitle.textContent = "The model is not certain";
    elements.readingMessage.textContent =
      "Try another crop, orientation, or image. Uncertainty is useful evidence about the model—not a failure.";
  } else {
    elements.readingTitle.textContent = winner.className;
    elements.readingMessage.textContent =
      READINGS[normalizedLabel] ??
      `For fun, let “${winner.className}” be a reminder to stay curious and test another example.`;
  }

  elements.resultsPanel.hidden = false;
}

async function handleImageSelection(event) {
  const file = event.target.files?.[0];
  elements.resultsPanel.hidden = true;

  try {
    validateImage(file);
    elements.fileName.textContent = file.name;
    await loadPreview(file);

    if (!model) {
      throw new Error("The model is not ready. Try reloading the classifier.");
    }

    setStatus({
      title: "Examining the image…",
      message: "Prediction runs locally in this browser.",
      badge: "Predicting",
      tone: "busy",
    });

    const startedAt = performance.now();
    const predictions = await model.predict(elements.imagePreview, false);
    const elapsedMs = performance.now() - startedAt;

    if (!Array.isArray(predictions) || predictions.length === 0) {
      throw new Error("The model returned no class predictions.");
    }

    renderPredictions(predictions, elapsedMs);
    setStatus({
      title: "Prediction complete",
      message: "Compare the confidence values and try another held-out image.",
      badge: "Complete",
      tone: "ready",
    });
  } catch (error) {
    console.error("Prediction failed", error);
    setStatus({
      title: "This image could not be classified",
      message: error instanceof Error ? error.message : "Choose a different image and try again.",
      badge: "Image error",
      tone: "error",
    });
  } finally {
    event.target.value = "";
  }
}

elements.imageInput.addEventListener("change", handleImageSelection);
elements.retryButton.addEventListener("click", initialize);
window.addEventListener("offline", () => {
  if (!model) {
    setStatus({
      title: "This browser is offline",
      message: "Reconnect to download the classroom model, then try again.",
      badge: "Offline",
      tone: "error",
      retry: true,
    });
  }
});
window.addEventListener("beforeunload", () => {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
  }
});

initialize();
