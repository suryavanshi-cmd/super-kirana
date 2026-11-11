# Reading a list from a photo

The reader is pluggable (`src/lib/ocr/types.ts`): a provider only returns text; everything about
quantities, prices and matching happens in one deterministic parser.

## Providers compared (November 2026)

| Provider | Marathi print | Marathi handwriting | English handwriting | Cost | Privacy | On a phone |
| --- | --- | --- | --- | --- | --- | --- |
| Tesseract in the browser (used by default) | yes | **no** | poor | free | photo never leaves the phone | ~20 MB one-time download, a few seconds per photo |
| Google Cloud Vision, document text (optional) | yes | Devanagari handwriting listed as **experimental** | yes | first 1,000 photos a month free, then about $1.50 per 1,000 | photo goes to Google | fast, needs internet |
| Azure AI Vision Read | yes | not supported (handwriting list has no Indian language) | yes | similar | photo goes to Microsoft | fast, needs internet |

Sources: [Google Cloud Vision language support](https://docs.cloud.google.com/vision/docs/languages),
[Azure AI Vision language support](https://learn.microsoft.com/en-us/azure/ai-services/computer-vision/language-support),
[Cloud Vision pricing](https://cloud.google.com/vision/pricing).

**Choice:** on-device Tesseract by default, because it is free, private and works for printed
lists; Google Cloud Vision as the optional provider for handwriting, because it is the only one of
the three with any Devanagari handwriting support. No provider reads every handwritten Marathi
list correctly, and the app says so on the scan screen.

The cloud provider is deployed but **off and untested** until the `GOOGLE_VISION_API_KEY`
function secret is set.

## Rules the parser follows
- A price is taken only when it is written on the line. A missing price is never invented; if the
  product is in the catalogue, its saved price is shown as a suggestion to accept or change.
- A number that could be either the rate or the line total is flagged and the shopkeeper chooses.
- 500 g of a per-kg product is priced at the per-kg rate for 0.5 kg.
- Low confidence, or nothing readable, shows "फोटो स्पष्ट नाही" and offers typing the list.
- Every line must be ticked as checked before the list can go to a bill, and the result is only a
  bill draft: the bill and its payment are confirmed separately. Nothing is ever posted from OCR.
