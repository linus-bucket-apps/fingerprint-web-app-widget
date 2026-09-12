# Fingerprint Pattern Explorer widget

A small static widget for the Fingerprint Workshop MVP. It loads a teacher-approved
Teachable Machine image model selected by the `model` URL query parameter, runs
predictions locally in the visitor's browser, and is intended to be embedded in a
published Wix site.

This is an educational pattern-classification experiment. It is not a fingerprint
identification or forensic system.

## Current state

The widget shell is ready. The catalog includes the alias `demo-a`, but its model
files have not been added yet.

Expected model files:

```text
models/demo-a/v1/
├── model.json
├── metadata.json
└── one or more .bin weight files
```

Extract the contents of a Teachable Machine **TensorFlow.js** export directly into
that directory. Do not rename weight files, because `model.json` refers to their
exported names.

## Run locally

Browser security prevents `fetch()` from working reliably when `index.html` is
opened directly. Serve the repository from its root instead:

```sh
python3 -m http.server 8000
```

Then test these URLs:

- `http://localhost:8000/` — deliberate no-model state
- `http://localhost:8000/?model=demo-a` — model loading and prediction
- `http://localhost:8000/?model=does-not-exist` — invalid alias state

The first model load also downloads pinned TensorFlow.js and Teachable Machine
browser libraries from jsDelivr. These can be self-hosted later if the school
network test shows that the CDN is blocked.

## Catalog format

Only aliases listed in `models/catalog.json` are accepted:

```json
{
  "demo-a": {
    "path": "./models/demo-a/v1/"
  }
}
```

Paths must stay under this site's `models/` directory. Use anonymous aliases and
versioned paths when adding classroom models.

## Before publishing

1. Add and test a real two-class TensorFlow.js export.
2. Verify all three URLs above in current Chrome and Edge.
3. Publish the repository with GitHub Pages from the `main` branch and root folder.
4. Test the public GitHub Pages URL directly.
5. Embed the valid model URL in Wix using **Embed a Site**.
6. Test image selection and prediction in the published Wix site.

The repository intentionally has no build step, package manager, backend,
analytics, or image upload service.
