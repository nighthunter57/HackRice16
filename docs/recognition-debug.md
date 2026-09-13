# Image recognition: implementation and verification

The pipeline is now:

`Expo picker → one resize/encode → authenticated /api/extract → image decode validation → Gemini → validated candidates → user confirmation → financial analysis`.

Recognition does not acquire the financial request lock or call Nessie, Tiger, Backboard, or the financial engine. Optional barcode lookup uses a separate authenticated `/api/product-lookup` request after candidates appear. The mobile user can request it without blocking selection or manual price entry. Only a confirmed product/price starts a purchase check.

## Image transport and preprocessing

Expo loads the local URI using `expo-image-manipulator`, preserves the whole frame without the previous editing/cropping step, resizes the long edge to at most 1600 pixels without upscaling, and encodes JPEG at 0.82 quality. The picker does not also generate base64. The resulting bytes are encoded once and sent as JSON `{imageBase64,mimeType}`. Retrying reuses those prepared bytes.

The Next web upload uses an object URL for decoding, a single canvas resize, and one base64 encoding of the final JPEG. It accepts originals up to 32 MiB; the **processed** payload must be at most 4 MiB. Original and output sizes are measured independently; small PNG text fixtures can grow when converted to JPEG.

The backend checks base64 format, decoded size, MIME signature, dimensions and actual successful image decoding with Sharp. Truncated files and MIME mismatches are rejected before Gemini. The image is not a `file://` string. Gemini receives actual `inlineData: {mimeType, data}` plus an explicit image-analysis instruction in the same user message. This follows Google's [image input documentation](https://ai.google.dev/gemini-api/docs/generate-content/image-understanding).

No images, base64, API keys or full provider error bodies are logged by the application. `GEMINI_API_KEY` remains server-side. An uploaded image stays in screen memory for retry; it is not added to purchase history.

## Model, prompt and partial results

The configured/default model is now **gemini-3.1-flash-lite**, verified against real images with structured JSON, a 30-second service deadline, zero temperature and a 2048-token output cap. It uses its supported default thinking behavior; the older zero-budget option applies only when explicitly selecting 2.5 Flash. See Google's [model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite).

The prompt explicitly uses physical appearance, packaging, logos, retail context, readable text, labels and barcodes. It distinguishes the target from neighboring products. Exact model, generation and price require evidence; no price search or financial calculations happen in Gemini. The model must return core output fields, while the application parser accepts missing optional details and nullable prices.

A confident product family with no exact candidate becomes a selectable family result. Multiple detected objects become selectable choices. A global visible price is not copied onto different objects. Missing prices remain null. Price confirmation is required before analysis.

There is no installed native barcode/OCR scanner in the scan flow. Gemini may read barcode digits; the existing UPCitemdb adapter can look up validated UPC/EAN digits afterward. Arbitrary QR URLs are never fetched. No additional OCR service was added.

## Timing definitions

| Measurement | Boundary |
| --- | --- |
| captureToReadyMs | Picker returns an asset → prepared image ready; excludes time spent taking/choosing the photo |
| imageResizeMs | Decode, resize and JPEG/base64 preparation |
| uploadMs | Client request round trip, including backend processing and response parsing; **not isolated network upload time** |
| backendReceiveMs | Backend handler start → authentication, JSON body read and image validation complete |
| geminiRequestMs | Gemini fetch and response body read |
| geminiParseMs | Envelope schema validation plus model JSON parsing/validation |
| totalRecognitionMs | Client: asset ready → recognition parsed; server: handler start → result; script: file read → result |

The response includes backend timings and `Server-Timing`. Logs contain request IDs, safe MIME/byte/dimension metadata, candidate count and stage timing. A successful request has one Gemini call. Failed calls report elapsed attempt time; unavailable parse measurements are null in the script, not invented zero-duration successful parses.

Development uses a five-minute cache bounded to 32 completed results. Keys include authenticated user, model, prompt version and input fingerprint. Concurrent identical requests share one request. Failed requests are not cached; production bypasses the cache. Cache-hit Gemini timings are zero because that request makes no model call.

## User experience and failures

The mobile screen progresses through “Analyzing photo…”, “Looking for product details…” and “Identifying likely matches…”. It displays Found it, Product found, Possible matches or manual/retry controls, and distinguishes alternate models from multiple objects. The client deadline is 45 seconds.

Safe diagnostic codes distinguish `GEMINI_AUTH_ERROR`, `GEMINI_RATE_LIMIT`, `GEMINI_TIMEOUT`, `GEMINI_INVALID_IMAGE`, `GEMINI_PARSE_ERROR`, `GEMINI_NO_MATCH` and connection/service failures. Users see plain-language messages. A failed recognition never claims that financial analysis succeeded.

## Recovery verified — September 13, 2026

The 2.5 Flash diagnostic returned HTTP 429 / RESOURCE_EXHAUSTED for `generate_content_free_tier_requests`, reporting limit 20. Image uploads were valid; the model quota was blocking scanning.

After checking model availability and the official multimodal documentation, real tests succeeded with **gemini-3.1-flash-lite**, which is now configured locally and is the default. No financial engine or authentication protection was bypassed.

| Real input | Recognition | Gemini ms | Total script ms |
| --- | --- | ---: | ---: |
| Project jacket-tag photo | Columbia Arcadia Jacket, RG2122, barcode 888665208012, visible $54.99 | 3815 | 3917 |
| Public Apple AirPods photo | Apple AirPods Pro family; multiple generation candidates, no fabricated SKU or price | 2951 | 3044 |

The real Expo web upload flow also passed against the running LAN backend and live Gemini: the jacket result appeared in **4.41 seconds**, and selecting it populated the confirmation price as **54.99**. No recognition responses were mocked in this check. The temporary test account was deleted afterward.

The jacket image resized from 434,028 bytes at 2560×2560 to 283,896 bytes at 1600×1600. Price remains integer cents (5499) and requires user confirmation. The prompt now explicitly prohibits recalled model/SKU identifiers when they are not legible. AirPods generation ranking remains uncertain and model confidence can overstate that distinction; the UI offers alternatives.

The older failed suite below is preserved as diagnostic history; it does not describe the newly configured model. The complete degraded-image suite has not been rerun against 3.1 Flash-Lite.

## Historical measurements — September 12–13, 2026

**Historical 2.5 Flash tests; superseded by the successful 3.1 tests above.** The initial real 1000×600 price-tag PNG test returned HTTP 200 with no candidates (about 3,091 ms request time; 3,097 ms total). After the pipeline changes, live requests were rejected with HTTP 429. One AirPods retry after the suggested delay returned HTTP 503. These are provider failures, not correct product matches or evidence of successful extraction.

The nine-image suite used two public Apple product photos and controlled synthetic/derived fixtures. Every fixture successfully decoded and reached the Gemini request, but every suite request returned HTTP 429. Confidence, family correctness, exact-model correctness, barcode accuracy and visible-price accuracy are therefore **unavailable for every row**.

| Fixture | Original bytes | Prepared bytes | Prepare ms | Failed request ms | Total script ms | Actual result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Packaging, synthetic Sony box | 21,534 | 35,407 | 24 | 415 | 439 | HTTP 429 |
| Barcode, synthetic EAN-13 | 13,026 | 27,686 | 19 | 200 | 219 | HTTP 429 |
| Visible price tag, synthetic Sony $249.00 | 27,307 | 27,959 | 20 | 254 | 275 | HTTP 429 |
| Visible brand/model text, cropped fixture | 18,659 | 20,307 | 15 | 272 | 287 | HTTP 429 |
| AirPods, no identifying text | 103,801 | 70,519 | 89 | 225 | 314 | HTTP 429 |
| Partially obscured AirPods, controlled overlay | 110,770 | 50,172 | 44 | 158 | 203 | HTTP 429 |
| Multiple products: AirPods + iPhone | 95,466 | 75,389 | 46 | 187 | 234 | HTTP 429 |
| Blurry AirPods, controlled blur | 111,178 | 48,013 | 43 | 177 | 220 | HTTP 429 |
| Low-light AirPods, controlled darkening | 90,255 | 34,185 | 45 | 226 | 271 | HTTP 429 |
| Original previously failing AirPods photo | — | — | — | — | — | Not supplied/found; not tested |

Mean fixture size: **65,777 → 43,293 bytes** (34% reduction). This is not a measured average of the user's phone photos. The AirPods image changed from 1960×1566 to 1600×1278. JPEG conversion increased the size of some small PNG fixtures.

The slowest measured stage in the initial non-rejected request was Gemini (~3.09 seconds). In the new suite, provider rejection took 158–415 ms, compared with 15–89 ms preprocessing. These failed-request times are **not successful recognition latency**. A successful optimized end-to-end phone latency remains unknown.

The model comparison used `gemini-2.5-flash-lite`, documented as multimodal and returned by the live model-list endpoint. Its actual AirPods generation request returned HTTP 404, so that comparison did not justify a model change. The later 3.1 Flash-Lite comparison above succeeded.

Fixtures came from [Apple's AirPods Pro announcement](https://www.apple.com/newsroom/2022/09/apple-announces-the-next-generation-of-airpods-pro/), specifically its hero and AirPods+iPhone images. Local fixture images and raw safe reports are in ignored `.local/recognition-fixtures/`. Synthetic packaging/barcode tests are not substitutes for real camera photos of packaging/barcodes.

## What was diagnosed

- The app already uploaded image bytes; no phone-local URI was being passed to Gemini as the image.
- Recognition queued behind financial requests because it used the financial advisory lock.
- Catalog lookup added a separate sequential wait before rendering candidates.
- The picker could crop away context; preprocessing and the web path also had avoidable encoding work.
- Useful family-only and partially populated outputs could be discarded or rejected.
- The image-only message lacked explicit user task text; required structured fields and visual/context guidance were strengthened.
- No unconditional duplicate Gemini call was found. Browser checks verified one upload per deliberate scan/retry. Repeated identical scans can now avoid another Gemini call in development.

The code-level issues are reproduced and covered. Their relative contribution to the original AirPods failure cannot be established without that photo and an available Gemini service.

## Verification and reproduction

Run a single real image independently of all financial services:

```sh
npm run gemini:image -- /path/to/photo.jpg
npm run gemini:image -- /path/to/photo.jpg --output .local/scan-report.json
npm run gemini:image -- /path/to/photo.jpg --model gemini-2.5-flash-lite
```

The script is development-only. It prints model, original/prepared dimensions and sizes, timings, normalized status, identity, confidence, barcode, price, evidence and candidates. A provider failure exits nonzero and includes only typed safe diagnostics. It never prints keys or base64.

Verified: 109 unit/regression tests passed; two database tests were skipped in the default suite. The recognition database test was then run explicitly and passed; the separate auth lifecycle suite was not rerun for this image change. TypeScript, lint, Next production build, Expo iOS/Android/web exports, and browser upload/retry/selection/manual-entry checks passed. Three exported mobile/web bundles were checked against configured server secret values; none were present. The browser decoded **80,062-byte JPEGs at 739×1600**, verified three uploads for three explicit actions and no financial call before confirmation. Recognition responses in that UI test were controlled fixtures, not live Gemini.

A separate opt-in integration test uses real PostgreSQL authentication and locking, actual decoded image bytes, and a controlled Gemini response. It verified authentication, exact image forwarding, invalid-image rejection, typed rate-limit handling and recognition completion while a financial lock remained held. The measured controlled request took 87 ms total, including 80 ms authentication/body validation; this is not live Gemini latency.

```sh
AUTH_INTEGRATION_TESTS=true node --env-file=.env.local --import tsx --test tests/recognition.integration.test.ts
```

Remaining checks: rerun the full degraded-image accuracy suite on the newly configured model, obtain the original failing AirPods photo, and test a physical phone under its actual network conditions. Restart Expo after installing dependencies; a custom native development build must include the newly added image-manipulator module.
