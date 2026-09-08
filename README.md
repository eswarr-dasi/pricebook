# pricebook

A grocery app that answers three questions in one scan: what does this cost at my store, what is actually in it, and will it keep me full.

Status: phase 1 app. Running code, no backend, no build step.

## Run it

There is no npm install and no bundler. The app is plain ES modules, so any static file server works.

    python3 -m http.server 8080

Then open http://localhost:8080

Camera scanning needs a secure context, so localhost or https only. It also needs a browser with BarcodeDetector, which today means Chrome or Edge on Android and desktop Chrome. Everywhere else the app falls back to typing the digits under the barcode, which is a first class path and not an error state.

To install it on a phone: serve over https, open in Chrome, then Add to home screen. It runs standalone and works offline from then on.

## Repo layout

    index.html               app shell and all markup
    manifest.webmanifest     PWA manifest
    sw.js                    service worker, offline shell and data cache
    icons/icon.svg           app icon
    src/styles.css           styles, mobile first, dark mode aware
    src/barcode.js           barcode normalization and camera scanning
    src/off.js               Open Food Facts client, cache first
    src/metrics.js           the three value metrics and the satiety estimate
    src/store.js             IndexedDB: product cache, price entries, settings
    src/app.js               UI wiring
    docs/                    product design and research

## What phase 1 does

Scan a barcode, or type it. Nutrition and ingredients come from Open Food Facts and are cached on the device. Enter the price you see on the shelf. The app shows cost per serving, cents per gram of protein, and fullness per dollar, plus cost per 100 g, calories per serving and calories per dollar.

Every price you save writes to a local price book. The app tells you your lowest price ever paid for that item, comparing on price per 100 g when sizes are known, because the same item in two sizes is not the same deal. Items missing from Open Food Facts can still be added by hand, which is what makes this usable at Costco, Aldi, Trader Joes and WinCo.

Everything is on device. No account, no server, no analytics. CSV export and a delete all button are both in the app.

## What phase 1 does not do yet

No retailer price API, so prices are entered by hand. No receipt import, which is the behavioural bet the whole product rests on and is unproven. No swap suggestions, no pantry cooking, no price alerts, no household sync. No photo calorie estimation, deliberately.

## Before this is deployed

Add icons/icon-192.png and icons/icon-512.png. The manifest already points at them and the SVG covers most cases, but iOS wants PNGs.

Open Food Facts data is ODbL licensed. The attribution line in the UI is required, so keep it.

Read the Kroger API terms of service before wiring any price integration. Only the API reference has been reviewed, not the legal terms.

## The problem

Food cost is the dominant household pain right now. The most upvoted posts in frugal and low-income communities are not tips, they are people manually tracking survival costs. A comparison of 103 prepped meals at 211.01 USD in Jan 2025 versus 228.76 USD in Jan 2026 drew 44k upvotes. A post noting that a pound of ground beef now costs more than the federal minimum hourly wage drew 41k.

Meanwhile the two big food scanning apps each answer half a question and neither answers the one people actually have.

## Positioning

Yuka tells you whether a package is virtuous. Roughly 50M users, 4.8 stars across 500k reviews, no ads and no brand influence. Its documented weakness: the r/nutrition thread titled What is wrong with the Yuka App has 79 comments arguing the good/bad categorization is not evidence based, the toxin framing is unscientific, and the score creates food anxiety.

Cal AI tells you how many calories are on the plate. 5M users, 4.9 stars, reportedly 2-3M USD per month. Photo plus depth sensor estimates volume, then a model identifies the food. Its own support page states the app is about 80 percent accurate. Its paywall fires on the first food you try to log, and the top four questions its support team receives are all billing: paywall after paying, how to cancel, refunds, and a warning that deleting the app does not stop charges.

The deeper problem with calorie tracking is not accuracy, it is fatigue. From the r/loseit thread asking why these apps are popular, 124 comments: people do not fail at eating well because they cannot count, they fail because logging every bite is exhausting and nobody sustains it.

Neither app tells you what it costs, whether you will be full, what to cook from what you already own, whether a suggested swap is affordable or in stock, or anything at all about fresh unpackaged food.

## The core idea

One question: was this worth it. Measured in money, fullness and nutrition together.

No good or bad labels anywhere. Nutri-Score and NOVA appear as cited third party classifications with a link to their methodology, never as our verdict. No weight goals, no calorie targets, no streaks.

## What makes it defensible

The price book. Your own scan and receipt history becomes a personal record of the lowest price you have ever paid for every item, across every store including ones with no API. It gets more useful the longer you use it and it is not transferable, so retention comes from accumulated value rather than lock-in.

This technique already has organic demand. A post titled I stopped chasing every deal and built a personal price book has 5,624 upvotes and 261 comments, and its author cut grocery costs 25 percent using a Google Sheet. People are asking for price book apps and Product Hunt returns essentially nothing.

## Docs

docs/PRODUCT.md - features, user flows, what we deliberately do not build

docs/DATA_SOURCES.md - verified free data sources and their limits

docs/ARCHITECTURE.md - system design and caching strategy

docs/COMPETITIVE.md - research findings with sources

docs/ROADMAP.md - three phases, kill criteria, open questions
