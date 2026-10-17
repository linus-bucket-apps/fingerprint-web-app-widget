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
  vm.runInContext('wixSlugs = testSlugs;', context);
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

test("root page keeps the compact single-result interface and original new-tab link", () => {
  assert.match(markup, /id="view-result"[^>]*target="_blank"/);
  assert.doesNotMatch(markup, /id="(?:result-list|preview-image|another-image)"/);
  const w = widget();
  const destination = w.context.getSafeResultUrl("Plain arch");
  w.context.showResult("Plain arch", destination);
  assert.equal(w.get("result-label").textContent, "Plain arch");
  assert.equal(w.get("view-result").href, "https://student.wixsite.com/fingerprint/plain-arch");
  assert.equal(w.get("view-result").hidden, false);
  assert.equal(w.get("drop-zone").hidden, true);
});

test("root still loads each catalog model, including demo-c's numbered page mappings", async () => {
  for (const alias of Object.keys(catalog)) {
    const w = widget({ query: `?model=${alias}` });
    w.context.fetch = async () => ({ ok: true, json: async () => catalog });
    let loadedPath;
    w.context.testLoad = async (base) => { loadedPath = base.pathname; return { predict: async () => raw }; };
    w.run("loadModel = testLoad");
    await w.context.initialize();
    assert.equal(loadedPath, `/course/models/${alias}/v1/`);
    assert.equal(w.get("image-input").disabled, false);
    for (const [label, slug] of Object.entries(catalog[alias].wixSlugs)) {
      assert.equal(w.context.getSafeResultUrl(label), `https://student.wixsite.com/fingerprint/${slug}`);
    }
  }
});

test("real classification displays only the highest-scoring label and releases its image", async () => {
  const w = widget();
  w.setModel(async () => [...raw].reverse());
  await classifyDecoded(w);
  assert.equal(w.get("result-label").textContent, "Plain arch");
  assert.equal(w.get("view-result").href, "https://student.wixsite.com/fingerprint/plain-arch");
  assert.deepEqual(w.revoked, ["blob:test-1"]);
  assert.equal(w.get("loading-overlay").hidden, true);
});

test("missing or untrusted Wix referrers preserve the winner while hiding navigation", () => {
  for (const referrer of ["", "https://example.com/", "http://student.wixsite.com/",
    "https://student.wixsite.com.evil.example/", "https://user:secret@student.wixsite.com/"]) {
    const w = widget({ referrer });
    w.context.showResult("Plain arch", w.context.getSafeResultUrl("Plain arch"));
    assert.equal(w.get("result-label").textContent, "Plain arch");
    assert.equal(w.get("view-result").hidden, true);
    assert.equal(w.get("view-result").href, undefined);
  }
});

test("invalid files show an error without decoding and leave upload available", async () => {
  for (const invalid of [{ type: "text/plain", size: 100 }, { type: "image/png", size: 16 * 1024 * 1024 }]) {
    const w = widget();
    w.setModel();
    await w.context.classify(invalid);
    assert.equal(w.images.length, 0);
    assert.equal(w.get("error-panel").hidden, false);
    assert.equal(w.get("image-input").disabled, false);
    assert.equal(w.get("result-panel").hidden, true);
  }
});

test("model-load failure offers retry and a successful retry clears the error", async () => {
  const w = widget();
  w.context.fetch = async () => { throw new Error("Temporary failure"); };
  await w.context.initialize();
  assert.equal(w.get("retry-button").hidden, false);
  w.context.fetch = async () => ({ ok: true, json: async () => catalog });
  w.context.testLoad = async () => ({ predict: async () => raw });
  w.run("loadModel = testLoad");
  await w.context.initialize();
  assert.equal(w.get("error-panel").hidden, true);
  assert.equal(w.get("image-input").disabled, false);
});

test("model reinitialization prevents an earlier inference from resurfacing", async () => {
  const w = widget();
  const prediction = deferred();
  w.setModel(() => prediction.promise);
  const pending = w.context.classify(file);
  w.images[0].dispatch("load");
  await flush();
  w.context.fetch = async () => ({ ok: true, json: async () => catalog });
  w.context.testLoad = async () => ({ predict: async () => raw });
  w.run("loadModel = testLoad");
  await w.context.initialize();
  prediction.resolve(raw);
  await pending;
  assert.equal(w.get("result-panel").hidden, true);
  assert.equal(w.get("view-result").href, undefined);
});
