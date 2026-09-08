# Product spec

## The one-line promise

Scan it, and know what it costs you, what is in it, and whether it will fill you up.

## Core value metrics

Every item and every meal is described by three numbers, never by a grade.

1. Cost per serving. What one real portion costs at the store you are standing in.
2. Cost per gram of protein. The single most useful value number in a grocery aisle and nobody computes it.
3. Fullness per dollar. A satiety estimate divided by price.

Secondary: calories per dollar, cost per 100g, and delta against your personal best price.

## Satiety estimate

The r/loseit critique of calorie apps proposed its own fix: stop obsessing over numbers and eat foods that are naturally filling. No mainstream app ships this.

Inputs: protein per 100g, fiber per 100g, water content, and energy density in kcal per gram. Energy density and protein plus fiber are the established drivers of satiety per serving.

Rules for presenting it:

- Always labeled an estimate, with the four inputs visible
- Never framed as medical or dietary guidance
- Never used to tell someone what to eat

## Features

### 1. Barcode scan

Barcode gives nutrition and ingredients from Open Food Facts, and price plus aisle plus stock level from the retailer API. Output is the three value metrics, the ingredient list as plain text, and Nutri-Score and NOVA shown as cited third party classifications with a methodology link.

### 2. Receipt import

The most important feature and the reason someone keeps the app. Photograph a grocery receipt once a week. That one action populates the price book, tells the app what is now in your kitchen, and produces a weekly cost per nutrient picture.

One action per week instead of three logging decisions per day. This is a structural answer to tracking fatigue, not a cosmetic one.

### 3. Price book

Every scan and every receipt line writes to a personal price history: item, store, size, unit price, date. The app remembers your lowest price ever paid per item and tells you in the aisle whether the price in front of you is good.

Works for stores with no API through manual entry, which is what makes the app usable at Costco, Aldi, Trader Joes and WinCo.

### 4. Affordable in-stock swaps

Yuka recommends healthier alternatives with no regard for price or availability. We recommend swaps that are better on the axis you chose, cheaper, and actually on the shelf. The retailer API returns stock level and aisle, so the suggestion is actionable while you are standing there.

Example output: same protein, 40 percent cheaper, aisle 7, in stock.

### 5. Pantry-first cooking

Given what your receipts say you bought, what can you cook tonight with nothing extra. Directly answers the recurring community question about what to keep on hand so you do not cave and order takeout.

### 6. Eating-out delta

This meal cost 2.40. The takeout equivalent is 18. Shown plainly, because eating out isn't even fun anymore drew 5,589 upvotes and 803 comments.

### 7. Rock-bottom price alerts

Your price book knows your personal low for every item. Tell you when pasta hits it. This gives the app a reason to exist between shopping trips.

### 8. Household mode

Cost per person, not per user. Families are who feel grocery inflation.

### 9. Visible uncertainty

Where Cal AI buries about 80 percent accurate in a help article, we show a range on every estimate, for example 480 to 620 calories, and offer a barcode scan to collapse it to exact.

## Deliberately not building

### Photo calorie estimation, at least not first

Flashiest and weakest. 80 percent accurate at best, commoditized, costly per call, and it is the exact feature driving the fatigue people quit over. If added later it is an optional convenience, never the core loop.

### Weight goals, calorie targets, streaks

The value and fullness framing avoids the disordered-eating pressure that both Cal AI's counting and Yuka's purity scoring create. No weight tracking, no streaks, no daily targets.

### Good and bad food labels

The top criticism of Yuka is that its moral scoring is not evidence based and creates anxiety. We show numbers and let people decide.

### Ads, affiliate links, brand placement

The entire reason this audience would trust the app is that it is not selling them anything. Yuka proved no-ads is a feature.

## Monetization

Free forever: scanning, nutrition, price book, one store.

One-time unlock around 5 to 8 USD: unlimited stores, CSV export, receipt history, alerts.

No subscription. Cal AI's support queue is dominated by paywall, cancellation and refund complaints, including a warning that deleting the app does not stop charges. Not having any of that is the positioning.

## Trust commitments, stated on the landing page

- No account required to use the core app
- Works offline in the store
- One-time purchase, nothing to cancel
- No ads, no affiliate links, no brand influence
- Your price history stays on your device unless you turn on sync
