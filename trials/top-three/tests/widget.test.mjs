import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../widget.js", import.meta.url), "utf8")
  .replace(/\ninitialize\(\);\s*$/, "");
const catalog = JSON.parse(readFileSync(new URL("../models/catalog.json", import.meta.url)));
const raw = [
  { className: "Plain arch", probability: 0.87654321 },
  { className: "Tented arch", probability: 0.07 },
  { className: "Ulnar loop", probability: 0.02 },
  { className: "Plain whorl", probability: 0.00002 },
];
const file = { type: "image/png", size: 1024, name: "fingerprint.png" };
const markup = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const copy = (value) => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

class Element {
  constructor(tagName = "div") {
    this.tagName = tagName.toUpperCase();
    this.hidden = true;
    this.disabled = false;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this._text = "";
    this.className = "";
    this.classList = {
      add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/), ...names])].filter(Boolean).join(" "); },
      remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(" "); },
      contains: (name) => this.className.split(/\s+/).includes(name),
      toggle: (name, force) => {
        const enabled = force ?? !this.classList.contains(name);
        this.classList[enabled ? "add" : "remove"](name);
        return enabled;
      },
    };
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map((child) => child.textContent ?? String(child)).join(""); }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name !== "style") this[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? this[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; delete this[name]; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); return child; }
  replaceChildren(...children) { this._text = ""; this.children = children; }
  addEventListener(name, listener) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]); }
  dispatch(name, event = {}) { for (const listener of this.listeners.get(name) ?? []) listener(event); }
  remove() { this.removed = true; }
  focus() { this.focused = true; }
}

function widget({ referrer = "https://student.wixsite.com/fingerprint/upload", query = "?model=demo-b", baseUrl = "https://widget.example/course/" } = {}) {
  const elements = new Map();
  const images = [];
  const created = [];
  const revoked = [];
  class BrowserURL extends URL {
    static createObjectURL(value) { const url = `blob:test-${created.length + 1}`; created.push({ url, file: value }); return url; }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  class BrowserImage extends Element {
    constructor() { super("img"); images.push(this); }
  }
  const document = {
    referrer,
    head: new Element("head"),
    querySelector(selector) {
      if (selector.startsWith("script[")) return null;
      if (!elements.has(selector)) elements.set(selector, new Element());
      return elements.get(selector);
    },
    createElement: (tagName) => new Element(tagName),
  };
  const context = vm.createContext({
    URL: BrowserURL, URLSearchParams, Image: BrowserImage, document,
    window: { location: new URL(`${baseUrl}${query}`), addEventListener() {} },
    navigator: { onLine: true }, console: { error() {} },
    fetch: async () => { throw new Error("Unexpected network request"); },
  });
  vm.runInContext(source, context);
  context.testSlugs = catalog["demo-b"].wixSlugs;
  vm.runInContext('wixSlugs = testSlugs; activeModelAlias = "demo-b";', context);
  return {
    context, elements, images, created, revoked, document,
    get: (id) => elements.get(`#${id}`),
    run: (code) => vm.runInContext(code, context),
    setModel(predict = async () => raw) { context.testModel = { predict }; vm.runInContext("model = testModel", context); },
  };
}

const descendants = (element) => element.children.flatMap((child) => [child, ...descendants(child)]);
const findTag = (element, tag) => descendants(element).filter((child) => child.tagName === tag.toUpperCase());
const flush = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };
async function classifyDecoded(w, selectedFile = file) {
  const pending = w.context.classify(selectedFile);
  assert.equal(w.images.length > 0, true);
  w.images.at(-1).dispatch("load");
  await pending;
}

test("the actual page supplies every static element required by the widget", () => {
  for (const [, selector] of source.matchAll(/document\.querySelector\("([.#][\w-]+)"\)/g)) {
    const name = selector.slice(1);
    const present = selector.startsWith("#")
      ? markup.includes(`id="${name}"`)
      : [...markup.matchAll(/class="([^"]+)"/g)].some((match) => match[1].split(/\s+/).includes(name));
    assert.equal(present, true, `Missing required widget element: ${selector}`);
  }
});

test("rank at most three known classes while preserving original model probabilities", () => {
  const w = widget();
  const ranked = copy(w.context.getRankedPredictions([...raw].reverse()));
  assert.deepEqual(ranked.map((prediction) => prediction.probability), [0.87654321, 0.07, 0.02]);
  assert.deepEqual(ranked.map((prediction) => prediction.slug), ["plain-arch", "tented-arch", "ulnar-loop"]);
  assert.equal(w.context.formatProbability(0.00002), "<0.1%");
  assert.equal(w.context.formatProbability(0), "0.0%");
});

test("catalog exports include complete weights and mappings for every model label", () => {
  const sizes = { float32: 4, int32: 4, bool: 1, complex64: 8, uint8: 1, uint16: 2 };
  for (const entry of Object.values(catalog)) {
    const base = new URL(entry.path, new URL("../", import.meta.url));
    const metadata = JSON.parse(readFileSync(new URL("metadata.json", base)));
    const model = JSON.parse(readFileSync(new URL("model.json", base)));
    assert.deepEqual(Object.keys(entry.wixSlugs).sort(), [...metadata.labels].sort());
    assert.equal(new Set(Object.values(entry.wixSlugs)).size, metadata.labels.length);
    for (const group of model.weightsManifest) {
      const actual = group.paths.reduce((total, path) => total + readFileSync(new URL(path, base)).length, 0);
      const expected = group.weights.reduce((total, weight) => {
        const size = sizes[weight.quantization?.dtype ?? weight.dtype];
        assert.ok(size, `Unsupported weight encoding: ${weight.dtype}`);
        return total + weight.shape.reduce((count, dimension) => count * dimension, 1) * size;
      }, 0);
      assert.equal(actual, expected, `${base.pathname} weights do not match their manifest`);
    }
  }
});

test("demo-c initializes its own model and routes numbered predictions to the matching type pages", async () => {
  const labels = Array.from({ length: 8 }, (_, index) => `type-${index + 1}`);
  assert.deepEqual(catalog["demo-c"].wixSlugs, Object.fromEntries(labels.map((label) => [label, label])));
  const w = widget({ query: "?model=demo-c" });
  w.context.fetch = async () => ({ ok: true, json: async () => catalog });
  let loadedPath;
  w.context.testLoad = async (base) => {
    loadedPath = base.pathname;
    return { predict: async () => labels.map((className, index) => ({
      className, probability: [0.76, 0.01, 0.01, 0.02, 0.14, 0.01, 0.01, 0.04][index],
    })) };
  };
  w.run("loadModel = testLoad");
  await w.context.initialize();
  assert.equal(loadedPath, "/course/models/demo-c/v1/");
  assert.equal(w.get("image-input").disabled, false);
  await classifyDecoded(w);
  assert.deepEqual(findTag(w.get("result-list"), "a").map((link) => new URL(link.href).pathname),
    ["/fingerprint/type-1", "/fingerprint/type-5", "/fingerprint/type-8"]);
});

test("reject empty, duplicate, unknown, nonnumeric and out-of-range predictions", () => {
  const w = widget();
  for (const probability of [NaN, Infinity, -0.1, 1.1, "0.9", null]) {
    assert.throws(() => w.context.getRankedPredictions([{ className: "Plain arch", probability }]));
  }
  for (const predictions of [null, {}, [], [raw[0], raw[0]], [{ className: "Unknown", probability: 1 }], [null]]) {
    assert.throws(() => w.context.getRankedPredictions(predictions));
  }
});

test("validate image type and size before allocating an image URL", async () => {
  const w = widget();
  w.setModel();
  for (const selected of [undefined, { ...file, type: "image/svg+xml" }, { ...file, size: 15 * 1024 * 1024 + 1 }]) {
    await w.context.classify(selected);
    assert.equal(w.get("error-panel").hidden, false);
    assert.equal(w.get("loading-overlay").hidden, true);
    assert.equal(w.get("image-input").disabled, false);
    assert.equal(w.images.length, 0);
    assert.equal(w.created.length, 0);
  }
  assert.doesNotThrow(() => w.context.validateImage({ ...file, size: 15 * 1024 * 1024 }));
});

test("missing classifier reports an actionable error and keeps upload disabled", async () => {
  const w = widget();
  await w.context.classify(file);
  assert.match(w.get("error-message").textContent, /loading|load|ready/i);
  assert.equal(w.get("image-input").disabled, true);
  assert.equal(w.get("loading-overlay").hidden, true);
  assert.equal(w.created.length, 0);
});

test("reset while image decoding prevents inference and revokes the abandoned image", async () => {
  const w = widget();
  let calls = 0;
  w.setModel(async () => { calls += 1; return raw; });
  const pending = w.context.classify(file);
  w.context.resetClassification();
  w.images[0].dispatch("load");
  await pending;
  assert.equal(calls, 0);
  assert.deepEqual(w.revoked, ["blob:test-1"]);
  assert.equal(w.get("result-panel").hidden, true);
  assert.equal(w.get("image-input").disabled, false);
});

test("reset during inference suppresses late results and releases the image URL", async () => {
  const w = widget();
  const prediction = deferred();
  w.setModel(() => prediction.promise);
  const pending = w.context.classify(file);
  w.images[0].dispatch("load");
  await flush();
  w.context.resetClassification();
  prediction.resolve(raw);
  await pending;
  assert.equal(w.get("result-panel").hidden, true);
  assert.equal(w.get("result-list").children.length, 0);
  assert.deepEqual(w.revoked, ["blob:test-1"]);
  assert.equal(w.get("loading-overlay").hidden, true);
});

test("a late failure from an older request cannot replace a newer successful result", async () => {
  const w = widget();
  const older = deferred();
  let calls = 0;
  w.setModel(() => ++calls === 1 ? older.promise : Promise.resolve(raw));
  const first = w.context.classify(file);
  w.images[0].dispatch("load");
  await flush();
  await classifyDecoded(w);
  older.reject(new Error("Old inference failed"));
  await first;
  assert.equal(w.get("result-panel").hidden, false);
  assert.equal(w.get("error-panel").hidden, true);
  assert.equal(w.get("result-list").children.length, 3);
  assert.deepEqual(w.revoked, ["blob:test-1"]);
});

test("image decode and prediction failures clean up URLs and allow another upload", async () => {
  for (const failure of ["decode", "prediction", "invalid predictions"]) {
    const w = widget();
    w.setModel(async () => {
      if (failure === "prediction") throw new Error("Inference failed");
      return [];
    });
    const pending = w.context.classify(file);
    w.images[0].dispatch(failure === "decode" ? "error" : "load");
    await pending;
    assert.equal(w.get("error-panel").hidden, false);
    assert.equal(w.get("result-panel").hidden, true);
    assert.equal(w.get("image-input").disabled, false);
    assert.equal(w.get("loading-overlay").hidden, true);
    assert.deepEqual(w.revoked, ["blob:test-1"]);
  }
});

test("initialization rejects missing, malformed and unavailable model links without loading a model", async () => {
  for (const [query, message] of [["", /model link/], ["?model=..%2Fprivate", /not valid/], ["?model=unknown", /not available/]]) {
    const w = widget({ query });
    w.context.fetch = async () => ({ ok: true, json: async () => catalog });
    let loads = 0;
    w.context.testLoad = async () => { loads += 1; return {}; };
    w.run("loadModel = testLoad");
    await w.context.initialize();
    assert.match(w.get("error-message").textContent, message);
    assert.equal(w.get("image-input").disabled, true);
    assert.equal(loads, 0);
  }
});

test("initialization failure offers retry, and retry clears errors and enables uploads", async () => {
  const w = widget();
  w.context.fetch = async () => { throw new Error("Temporary outage"); };
  await w.context.initialize();
  assert.equal(w.get("retry-button").hidden, false);
  assert.equal(w.get("image-input").disabled, true);
  w.context.fetch = async () => ({ ok: true, json: async () => catalog });
  w.context.testLoad = async () => ({ predict: async () => raw });
  w.run("loadModel = testLoad");
  await w.context.initialize();
  assert.equal(w.get("error-panel").hidden, true);
  assert.equal(w.get("retry-button").hidden, true);
  assert.equal(w.get("image-input").disabled, false);
});

test("bars use original probabilities, readable labels, and direct Wix category arrows", () => {
  const w = widget();
  const ranked = w.context.getRankedPredictions([
    { className: "Plain arch", probability: 0.87654321 },
    { className: "Tented arch", probability: 0.07 },
    { className: "Ulnar loop", probability: 0.00002 },
  ]);
  w.context.showResults(ranked);
  const rows = w.get("result-list").children;
  assert.equal(rows.length, 3);
  for (let index = 0; index < rows.length; index += 1) {
    const prediction = ranked[index];
    const all = descendants(rows[index]);
    const meter = all.find((element) => element.getAttribute("role") === "meter");
    const fill = all.find((element) => element.classList.contains("prediction-fill"));
    const [link] = findTag(rows[index], "a");
    assert.match(rows[index].textContent, new RegExp(prediction.className));
    assert.equal(rows[index].textContent.includes(w.context.formatProbability(prediction.probability)), true);
    assert.equal(Number(meter.getAttribute("aria-valuenow")), prediction.probability);
    assert.equal(fill.style.width, `${prediction.probability * 100}%`);
    assert.equal(link.href, `https://student.wixsite.com/fingerprint/${prediction.slug}`);
    assert.equal(link.target, "_blank");
    assert.equal(link.rel, "noopener");
    assert.match(link.getAttribute("aria-label"), new RegExp(prediction.className));
    assert.match(link.getAttribute("aria-label"), /opens in a new tab/);
  }
  assert.equal(w.get("result-panel").hidden, false);
  assert.equal(w.get("drop-zone").hidden, true);
});

test("untrusted referrers preserve scores while rendering no active category links", () => {
  for (const referrer of ["", "not a URL", "https://example.com/", "http://student.wixsite.com/",
    "https://student.wixsite.com.evil.example/", "https://user:secret@student.wixsite.com/"]) {
    const w = widget({ referrer });
    w.context.showResults(w.context.getRankedPredictions(raw));
    assert.equal(findTag(w.get("result-list"), "a").length, 0, referrer);
    assert.equal(w.get("result-list").children.length, 3);
    assert.equal(w.get("result-hint").hidden, false);
    const control = w.get("result-list").children[0].children[1];
    assert.equal(control.textContent, "→");
    assert.equal(control.getAttribute("aria-disabled"), "true");
    assert.match(control.title, /published Wix site/);
  }
});

test("real classifications on loopback hosts have working sample arrows without a Wix referrer", () => {
  for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
    const w = widget({ referrer: "", baseUrl: `http://${host}:8000/course/` });
    w.context.showResults(w.context.getRankedPredictions(raw));
    const links = findTag(w.get("result-list"), "a");
    assert.equal(links.length, 3);
    for (const link of links) {
      assert.equal(link.textContent, "→");
      assert.equal(new URL(link.href).pathname, "/course/preview/category.html");
      assert.equal(new URL(link.href).hostname, host);
      assert.equal(link.target, "_self");
      assert.equal(link.rel, undefined);
      assert.match(link.getAttribute("aria-label"), /Sample destination/);
    }
  }
  for (const baseUrl of ["https://localhost.evil.example/", "https://127.0.0.1.evil.example/", "https://widget.example/"]) {
    const w = widget({ referrer: "", baseUrl });
    assert.equal(w.context.getSafeCategoryUrl("plain-arch"), null);
  }
  const embedded = widget({ baseUrl: "http://localhost:8000/" });
  assert.equal(embedded.context.getSafeCategoryUrl("plain-arch"), "https://student.wixsite.com/fingerprint/plain-arch");
});

test("category navigation validates slugs before constructing a destination", () => {
  const w = widget();
  for (const slug of ["../outside", "javascript:alert(1)", "/evil", "", "foo?bar=1", null]) {
    assert.equal(w.context.getSafeCategoryUrl(slug), null);
  }
});

test("two-class models show two bars without fabricating a third prediction", () => {
  const w = widget();
  w.context.testSlugs = catalog["demo-a"].wixSlugs;
  w.run('wixSlugs = testSlugs; activeModelAlias = "demo-a";');
  w.context.showResults(w.context.getRankedPredictions([
    { className: "Parallel Lines", probability: 0.6 },
    { className: "Concentric Circles", probability: 0.4 },
  ]));
  assert.equal(w.get("result-list").children.length, 2);
  assert.deepEqual(findTag(w.get("result-list"), "a").map((link) => new URL(link.href).pathname),
    ["/fingerprint/parallel-lines", "/fingerprint/concentric-circles"]);
});

test("unidentified threshold includes weak and close scores while respecting exact boundaries", () => {
  const w = widget();
  for (const [scores, expected] of [
    [[0.49, 0.1, 0.05], true],
    [[0.65, 0.51, 0.01], true],
    [[0.5, 0.35, 0.1], false],
    [[0.65, 0.5, 0.01], false],
    [[0.8, 0.1, 0.05], false],
    [[0.125, 0.125, 0.125], true],
  ]) {
    const ranked = w.context.getRankedPredictions(scores.map((probability, index) => ({
      className: raw[index].className, probability,
    })));
    assert.equal(w.context.isUnidentified(ranked), expected, JSON.stringify(scores));
    w.context.showResults(ranked);
    assert.equal(w.get("uncertainty-message").hidden, !expected, JSON.stringify(scores));
    assert.equal(w.get("result-list").hidden, expected);
    assert.equal(w.get("result-list").children.length, expected ? 0 : 3);
    if (expected) assert.equal(findTag(w.get("result-list"), "a").length, 0);
  }
});

test("an unidentified result clears earlier matches and links while retaining the image and restart", async () => {
  const w = widget();
  w.setModel();
  await classifyDecoded(w);
  assert.equal(findTag(w.get("result-list"), "a").length, 3);
  w.setModel(async () => [
    { className: "Double loop", probability: 0.43 },
    { className: "Central pocket loop", probability: 0.38 },
    { className: "Accidental whorl", probability: 0.15 },
  ]);
  await classifyDecoded(w);
  assert.equal(w.get("preview-image").src, "blob:test-2");
  assert.equal(w.get("result-list").children.length, 0);
  assert.equal(w.get("result-list").hidden, true);
  assert.equal(w.get("result-hint").hidden, true);
  assert.equal(w.get("another-image").hidden, false);
  assert.match(w.get("uncertainty-message").textContent, /Unidentified image/);
  w.context.resetClassification();
  assert.equal(w.get("uncertainty-message").hidden, true);
  assert.equal(w.get("image-input").disabled, false);
});

test("successful classification retains the fingerprint URL until reset", async () => {
  const w = widget();
  w.setModel();
  await classifyDecoded(w);
  assert.equal(w.get("preview-image").src, "blob:test-1");
  assert.deepEqual(w.revoked, []);
  w.context.resetClassification();
  assert.deepEqual(w.revoked, ["blob:test-1"]);
  assert.equal(w.get("preview-image").getAttribute("src"), null);
  assert.equal(w.get("result-panel").hidden, true);
  assert.equal(w.get("result-list").children.length, 0);
  assert.equal(w.get("image-input").disabled, false);
});

test("a new successful image replaces the old URL and clears previous error content", async () => {
  const w = widget();
  w.setModel();
  await classifyDecoded(w);
  await classifyDecoded(w);
  assert.equal(w.get("preview-image").src, "blob:test-2");
  assert.deepEqual(w.revoked, ["blob:test-1"]);
  assert.equal(w.get("error-panel").hidden, true);
  w.context.resetClassification();
  assert.deepEqual(w.revoked, ["blob:test-1", "blob:test-2"]);
});

test("strict preview scenarios use synthetic data without requesting a model", async () => {
  for (const scenario of ["clear", "close", "diffuse", "two-class"]) {
    const w = widget({ query: `?preview=${scenario}` });
    await w.context.initialize();
    assert.equal(w.get("result-panel").hidden, false, scenario);
    assert.equal(w.get("error-panel").hidden, true, scenario);
    assert.equal(w.get("demo-banner").hidden, false, scenario);
    assert.match(w.get("demo-banner").textContent, /synthetic|sample|demo/i);
    assert.match(w.get("preview-image").src, /preview\/fingerprint\.svg$/);
    assert.equal(w.get("result-list").children.length, scenario === "two-class" ? 2 : scenario === "clear" ? 3 : 0);
    assert.equal(w.get("uncertainty-message").hidden, scenario === "clear" || scenario === "two-class");
  }
  const invalid = widget({ query: "?preview=unknown" });
  await invalid.context.initialize();
  assert.equal(invalid.get("result-panel").hidden, true);
  assert.match(invalid.get("error-message").textContent, /model link/i);
});

test("leaving preview opens the real upload flow for the matching model", async () => {
  for (const scenario of ["clear", "two-class"]) {
    const w = widget({ query: `?preview=${scenario}` });
    let destination;
    w.context.window.location.assign = (url) => { destination = new URL(url, w.context.window.location.href); };
    await w.context.initialize();
    w.context.resetClassification();
    assert.equal(destination.searchParams.has("preview"), false);
    assert.equal(destination.searchParams.get("model"), scenario === "two-class" ? "demo-a" : "demo-b");
    assert.equal(destination.origin, "https://widget.example");
  }
});

test("new initialization wins over a stale catalog failure or slow model load", async () => {
  for (const stalePhase of ["catalog", "model"]) {
    const w = widget();
    const older = deferred();
    let fetches = 0;
    let loads = 0;
    w.context.fetch = async () => {
      fetches += 1;
      if (stalePhase === "catalog" && fetches === 1) return older.promise;
      return { ok: true, json: async () => catalog };
    };
    w.context.testLoad = async () => {
      loads += 1;
      if (stalePhase === "model" && loads === 1) return older.promise;
      return { predict: async () => raw };
    };
    w.run("loadModel = testLoad");
    const first = w.context.initialize();
    await flush();
    assert.equal(w.get("image-input").disabled, true);
    assert.equal(w.get("loading-overlay").hidden, false);
    await w.context.initialize();
    older.reject(new Error("Stale setup failure"));
    await first;
    assert.equal(w.get("error-panel").hidden, true);
    assert.equal(w.get("image-input").disabled, false);
    assert.equal(w.get("loading-overlay").hidden, true);
    await classifyDecoded(w);
    assert.equal(w.get("result-panel").hidden, false);
  }
});

test("an older completion cannot hide the newer inference loading state", async () => {
  const w = widget();
  const older = deferred();
  const newer = deferred();
  let calls = 0;
  w.setModel(() => ++calls === 1 ? older.promise : newer.promise);
  const first = w.context.classify(file);
  w.images[0].dispatch("load");
  await flush();
  const second = w.context.classify(file);
  w.images[1].dispatch("load");
  await flush();
  older.resolve(raw);
  await first;
  assert.equal(w.get("loading-overlay").hidden, false);
  assert.equal(w.get("image-input").disabled, true);
  assert.equal(w.get("result-panel").hidden, true);
  newer.resolve(raw);
  await second;
  assert.equal(w.get("loading-overlay").hidden, true);
  assert.equal(w.get("preview-image").src, "blob:test-2");
  assert.deepEqual(w.revoked, ["blob:test-1"]);
});
