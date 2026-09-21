# Minimal image-classifier widget

A small static Teachable Machine image-classifier widget for embedding in a Wix
page. The widget loads a teacher-approved local model chosen by the `model` URL
query parameter and classifies each selected image in the visitor's browser.

Its normal UI is deliberately limited to three states:

- a 360 px-wide drag-and-drop image grid (the grid is also a keyboard-accessible
  file picker);
- an overlaid loading spinner while an uploaded image is being decoded and
  classified; and
- the predicted label plus a **View your result** link, when that label has a
  configured result URL.

There are no model names, confidence scores, image previews, privacy copy, or
other page content in the widget. Put instructions, privacy information and the
visual design in Wix around the iframe instead.

This is an educational pattern-classification experiment. It is not a fingerprint
identification or forensic system.

## Local model files

The catalog currently includes `demo-a`. Each model must be a Teachable Machine
**TensorFlow.js** export stored under `models/`:

```text
models/demo-a/v1/
├── model.json
├── metadata.json
└── one or more .bin weight files
```

Extract the export directly into the versioned directory. Do not rename weight
files because `model.json` references their exported filenames.

## Configure the result pages

Add an allowlisted HTTPS Wix page for every predicted class to that model's entry
in `models/catalog.json`. A key can be either the exact Teachable Machine label or
its lowercase, hyphenated result key. Exact labels take precedence.

```json
{
  "demo-a": {
    "path": "./models/demo-a/v1/",
    "resultUrls": {
      "Concentric Circles": "https://your-site.wixsite.com/fingerprint/concentric-circles",
      "parallel-lines": "https://your-site.wixsite.com/fingerprint/parallel-lines"
    }
  }
}
```

Only absolute `https:` URLs without embedded credentials are used. Invalid,
relative or unmapped URLs are ignored, so the widget shows the plain-text model
result without a link rather than navigating somewhere unexpected. Configure the
URLs before publishing; the sample catalog intentionally has no destination URLs.

The result anchor is rendered as:

```html
<a target="_top">View your result</a>
```

When Wix permits top-level navigation from its published embed, a visitor click
replaces the current Wix page with the mapped result page. Test this on the
published site, including mobile. If a browser blocks top-level navigation in the
embed, use a Wix-compatible new-tab fallback after testing.

## Run locally

Serve this directory rather than opening `index.html` directly:

```sh
python3 -m http.server 8000
```

Then open:

- `http://localhost:8000/?model=demo-a` — normal model load and classification
- `http://localhost:8000/` — missing-model error handling
- `http://localhost:8000/?model=does-not-exist` — unavailable-model handling

The first model load downloads the pinned TensorFlow.js and Teachable Machine
libraries from jsDelivr. Self-host them only if the school-network test shows the
CDN is unavailable.

## Wix setup

1. Create the category/result pages in Wix and publish them so each has an HTTPS
   URL.
2. Add those URLs to the relevant model's `resultUrls` map, then deploy this
   widget and confirm the public widget URL works directly.
3. Add the widget URL, including `?model=your-model-alias`, with Wix **Embed a
   Site**.
4. Start with an iframe around **360 × 170 px**. The upload and result states fit
   within that size; allow 210–250 px high if you want room for an error message.
5. Test drag/drop, keyboard upload, success navigation and errors on the
   *published* Wix site in desktop and mobile browsers.

The project has no build step, backend, analytics or image-upload service.
