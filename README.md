# Fingerprint explorer widget

A self-contained Teachable Machine classifier for a Wix embed. Visitors choose an
image, then see their fingerprint on the left and up to three horizontal probability
bars on the right. Each row has an arrow to that fingerprint type’s Wix page.
The model runs in the browser; the selected image stays in the browser.

## Preview for client review

Serve this directory (no build or package installation):

```sh
python3 -m http.server 8000
```

Open [the scenario chooser](http://localhost:8000/preview/), or a specific state:

- [Clear match](http://localhost:8000/?model=demo-b&preview=clear)
- [Close matches / unidentified](http://localhost:8000/?model=demo-b&preview=close)
- [Diffuse scores / unidentified](http://localhost:8000/?model=demo-b&preview=diffuse)
- [Two-class result](http://localhost:8000/?model=demo-a&preview=two-class)
- [Actual client classifier](http://localhost:8000/?model=demo-c)

These preview states use an illustrative SVG and explicitly labelled invented
scores, load no model libraries, and link to a sample category destination. They
are for reviewing the layout, not evaluating model accuracy. **Try another image**
exits the sample state and initializes the real classifier. Remove `preview` from
any production embed URL.

The design keeps the upload, inference, result chart, uncertainty handling and
retry flow inside the widget. The teacher controls that interface in HTML/CSS/JS.
Students still write and visually design the individual category pages in Wix.
If students need visual control over the chart itself, use the separate Wix-native
results approach instead. This branch is a reviewable alternative before deciding
whether to switch Wix editors or add conditional rendering there.

## Embed in Wix

Host `index.html`, `widget.js`, `widget.css`, `models/` and `preview/` together on an
HTTPS static host. Add **Embed a Site** on the Wix upload page, pointing to:

```text
https://teacher-name.github.io/fingerprint-web-app-widget/?model=demo-c
```

Start with an embed around **860 × 460 px** for desktop. On mobile, the image stacks
above the chart; allow roughly **700 px** height, more for
long labels. Verify the actual iframe on published desktop and mobile pages:
widget CSS cannot resize the containing Wix embed. No CMS, message handshake,
Velo results-page code or conditional Wix elements are required by this approach.

Create normal Wix pages using the category slugs in `models/catalog.json`:

```text
https://student-name.wixsite.com/fingerprint/type-1
https://student-name.wixsite.com/fingerprint/type-2
https://student-name.wixsite.com/fingerprint/type-8
```

Each arrow goes directly to its row’s page. The widget takes the HTTPS
`.wixsite.com` origin from `document.referrer`, combines it with
`CONFIG.wixSiteBasePath` (`/fingerprint/`), and appends the catalog’s validated slug.
Change that teacher-managed base path for sites published under a different path.
Custom domains and Wix Studio domains are not supported by this origin check.
Links use `target="_top"`; verify visitor-clicked navigation is allowed by the
published iframe in the required browsers. No image or scores are sent in the URL.

`demo-c` uses the client's numbered labels: `type-1` maps directly to `/type-1`,
through `type-8` to `/type-8`. No mapping to the named fingerprint categories is
assumed. The older `demo-b` still uses its named slugs. The sample result scenarios
use the older demo labels and invented scores; the real-classifier link uses `demo-c`.

On localhost (`localhost`, `127.0.0.1` or `::1`), real classifications also have
working arrows to the local sample category pages when there is no Wix referrer.
This keeps the design review usable after an actual image upload; it does not
substitute sample predictions for model inference. The arrow tooltip and accessible
label identify sample destinations.

On other hosts with a missing or untrusted referrer (including some Wix Preview/
privacy settings), the image and chart still work. Arrows are visibly disabled;
their tooltips explain that the published Wix site is needed. Test real navigation
from the published site, not only the sample destinations.

## Predictions and unidentified cases

One model inference supplies all class scores. The widget validates them, sorts
them and keeps up to three predictions. Two-class models display only two bars.
The bar widths use the original probabilities on a 0–100% scale; the selected
scores are never rescaled to total 100%. Labels show one decimal place, with
positive scores below 0.1% displayed as `<0.1%`.

The initial experimental confidence rule marks the image **Unidentified** if the
leading score is below **50%**, or the lead over second place is below **15
percentage points**. Those constants are in `CONFIG` in `widget.js`. Unidentified
results hide all prediction bars, scores and category arrows. The selected image
and restart button remain visible beside a short retry message. A low-scoring
alternative does not make a clear 90% leader uncertain.

These thresholds need validation for the trained model. A high score cannot prove
that an arbitrary image is a valid fingerprint; this rule handles uncertain scores
and is not a guaranteed detector of non-fingerprint inputs. The supplied models
have not been validated as production models. This is an
educational pattern experiment, not fingerprint identification or a forensic tool.

## Models and checks

Each model export contains `model.json`, `metadata.json` and its referenced `.bin`
weights in a versioned folder under `models/`. Do not rename weight files. The
`model` query parameter selects an alias in `models/catalog.json`; every label
must map to a unique lowercase category slug. `demo-a` has two classes and
`demo-b` has eight named classes. `demo-c` is the unmodified client export from
`client-set-224/tm-my-image-model.zip`, with eight numbered classes (`type-1`
through `type-8`). Missing, malformed or unknown aliases show a setup error.

TensorFlow.js and Teachable Machine load from pinned CDN URLs in `widget.js`.
There is no prediction backend, analytics service or image-upload endpoint.
Selected image object URLs are released on reset/error; the image is retained
while its results are displayed. Supported images: PNG, JPEG, WebP, GIF and BMP,
up to 15 MB. Invalid or undecodable files return to upload with an error.

Run the widget checks:

```sh
node --test tests/widget.test.mjs
```

Before a student rollout, test real image upload, reset and repeated upload,
model-load retry/offline states, both model sizes, uncertainty messages,
keyboard operation, long labels and mobile iframe sizing. A published Wix test is
still needed to confirm the referrer and top-level category navigation. Creating
a PR does not publish or merge this prototype.
