# Minimal image-classifier widget

A small static Teachable Machine image-classifier widget for embedding in a Wix
page. The widget loads a teacher-approved local model chosen by the `model` URL
query parameter and classifies each selected image in the visitor's browser.

Its normal UI is deliberately limited to three states:

- a 360 px-wide drag-and-drop image grid (the grid is also a keyboard-accessible
  file picker);
- an overlaid loading spinner while an uploaded image is being decoded and
  classified; and
- the predicted label plus a **View your result** link when the widget can identify
  the published Wix site that contains it.

There are no model names, confidence scores, image previews, privacy copy, or
other page content in the widget. Put instructions, privacy information and the
visual design in Wix around the iframe instead.

This is an educational pattern-classification experiment. It is not a fingerprint
identification or forensic system.

## Local model files

The catalog currently includes `demo-a` and `demo-b`. Each model must be a
Teachable Machine **TensorFlow.js** export stored under `models/`:

```text
models/demo-a/v1/
├── model.json
├── metadata.json
└── one or more .bin weight files
```

Extract the export directly into the versioned directory. Do not rename weight
files because `model.json` references their exported filenames.

## Configure the Wix result pages

Every student must publish their Wix site with `fingerprint` as its site path:

```text
https://student-name.wixsite.com/fingerprint
```

Create one page under that site for every model category. The widget reads each
category's explicit Wix slug from `models/catalog.json`:

| Model | Model category | Wix slug | Wix result path |
| --- | --- | --- | --- |
| `demo-a` | `Concentric Circles` | `concentric-circles` | `/fingerprint/concentric-circles` |
| `demo-a` | `Parallel Lines` | `parallel-lines` | `/fingerprint/parallel-lines` |
| `demo-b` | `Accidental whorl` | `accidental-whorl` | `/fingerprint/accidental-whorl` |
| `demo-b` | `Central pocket loop` | `central-pocket-loop` | `/fingerprint/central-pocket-loop` |
| `demo-b` | `Double loop` | `double-loop` | `/fingerprint/double-loop` |
| `demo-b` | `Plain arch` | `plain-arch` | `/fingerprint/plain-arch` |
| `demo-b` | `Plain whorl` | `plain-whorl` | `/fingerprint/plain-whorl` |
| `demo-b` | `Radial loop` | `radial-loop` | `/fingerprint/radial-loop` |
| `demo-b` | `Tented arch` | `tented-arch` | `/fingerprint/tented-arch` |
| `demo-b` | `Ulnar loop` | `ulnar-loop` | `/fingerprint/ulnar-loop` |

Slugs must be unique within a model and use lowercase letters, numbers, and single
hyphens. Students can design these pages freely in Wix; no per-student domain
needs to be added to the model catalog.

When embedded on a published Wix page, the widget reads `document.referrer` to
obtain the parent site's HTTPS origin. Modern Chrome and Edge normally provide the
origin for a cross-origin iframe, but omit the parent's path. The widget therefore
combines that origin with the fixed `/fingerprint/` path and the category slug:

```text
document.referrer: https://student-name.wixsite.com/
fixed site path:   /fingerprint/
category slug:     plain-arch
result URL:        https://student-name.wixsite.com/fingerprint/plain-arch
```

For safety, result links are created only when the referrer uses HTTPS and its
hostname ends in `.wixsite.com`. If the referrer is missing or rejected, the
widget still shows the plain-text model result but hides the link. This fallback
can occur when the widget is opened directly, in Wix Preview, or when a privacy
extension or managed browser policy removes referrer information.

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

1. Set the Wix site's published site path to exactly `fingerprint`.
2. Create and design one result page per model category, using the corresponding
   Wix slug from `models/catalog.json`, and publish the site.
3. Deploy the widget and confirm its public URL loads successfully.
4. Add the widget URL, including `?model=your-model-alias`, with Wix **Embed a
   Site**.
5. Start with an iframe around **360 × 170 px**. The upload and result states fit
   within that size; allow 210–250 px high if you want room for an error message.
6. Test drag/drop, keyboard upload, success navigation and errors on the
   *published* Wix site in Chrome and Edge, including mobile where relevant. Wix
   Preview may not expose the student's published domain as the referrer.

The project has no build step, backend, analytics or image-upload service.
