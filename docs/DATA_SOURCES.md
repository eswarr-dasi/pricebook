# Data sources

Everything below was verified live during research. Both primary sources are free.

## Open Food Facts - nutrition and ingredients

Status: verified working, no API key required.

Endpoint pattern: world.openfoodfacts.org/api/v2/product/BARCODE.json with an optional fields parameter.

A live test on a US Pringles barcode returned: product name, brand, full ingredients text, per-serving and per-100g nutriments, serving size, Nutri-Score grade e, and NOVA group 4.

License: Open Database License for the database, Database Contents License for individual contents, CC-BY-SA for product images. Share-alike applies, so read the reuse terms before redistributing.

### Do not depend on their live API

During research their site returned a page saying services are experiencing unusually high demand and that anonymous users are subject to request limits. They serve roughly 8 million visitors a month on donations and were publicly short 120,000 EUR for 2026.

Mirror the dump instead. Nightly exports are available as:

- MongoDB dump
- - JSONL, roughly 9 GB uncompressed
  - - Parquet on Hugging Face, a simplified column-filtered version
    - - CSV via the advanced search form
      - - Daily delta exports covering the previous 14 days
       
        - Plan: seed from the full dump, apply daily deltas, serve lookups from our own store. Deltas cannot express deletions, so re-seed from the full dump periodically.
       
        - ### Coverage caveat
       
        - US coverage is thinner than Europe and it is crowdsourced, so some barcodes will miss. Turn that into a contribution loop: let the user photograph the label and submit it back upstream. Fills our gaps and is good citizenship toward a dataset we depend on.
       
        - ## Kroger Public Products API - price, aisle, stock
       
        - Status: verified in their published API reference. This is the surprising find that makes the price half of the product possible.
       
        - Free public tier with a 10,000 call per day rate limit, enforced across all operations on the products endpoint.
       
        - ### Barcode to product
       
        - The productId filter takes a 13 digit number. Their docs state that when converting from a barcode you omit the check digit. So a scanned UPC or EAN maps directly to a Kroger product.
       
        - ### What you get with a locationId
       
        - Pass the locationId filter and the response adds:
       
        - - price, containing both regular and promo price
          - - nationalPrice, containing regular and promo national price
            - - fulfillment flags for instore, shiptohome, delivery, curbside
              - - aisle locations for the item at that store
                - - stockLevel of HIGH, LOW or TEMPORARILY_OUT_OF_STOCK
                 
                  - That means one scan yields price at your store today, whether it is on promo, which aisle, and whether it is actually on the shelf.
                 
                  - ### Why this is the right launch wedge
                 
                  - Kroger banners include QFC and Fred Meyer, which are dense in Bellevue and Seattle. Dogfood at the actual store, launch one metro, expand later.
                 
                  - ### Constraints and mitigations
                 
                  - 10,000 calls per day is the binding constraint. Mitigation: cache by locationId plus productId with a TTL of hours to days. Grocery prices move weekly, not hourly, so every user shopping at the same store shares one upstream call. A generous cache turns the free tier into something that serves thousands of users.
                 
                  - Read their terms of service before shipping. A public tier can be revoked, so never make it the only source of price. The manual price book is the permanent hedge.
                 
                  - Other filters available: term, brand, fulfillment, start, limit. Location API provides store lookup, needed for the store picker.
                 
                  - ## Receipt import - no ready source
                 
                  - There is no API for this, it is OCR plus per-retailer parsing. Receipt formats vary wildly by chain.
                 
                  - Approach: start with one chain's receipt format, get it genuinely reliable, then expand. Line item text is abbreviated and inconsistent, so item matching to a canonical product needs a fuzzy match against the price book plus a user confirmation step.
                 
                  - This is the hardest engineering problem in the product and also the highest value feature, so it is phase two rather than phase one.
                 
                  - ## Fresh produce and meat - unsolved
                 
                  - No barcodes, and this is where a large share of grocery spending goes. PLU codes cover some produce. Manual entry covers the rest.
                 
                  - Be upfront that v1 handles packaged goods only. This is a phase three problem.
                 
                  - ## Barcode normalization - the top source of bugs
                 
                  - UPC-A is 12 digits, EAN-13 is 13. Open Food Facts keys on the full barcode. Kroger wants 13 digits with the check digit omitted.
                 
                  - Get the normalization layer right on day one with a test fixture of real barcodes from both sources. This will be the number one cause of not found errors.
                 
                  - ## Sources deliberately not used
                 
                  - Nutrition APIs with per-call pricing, since Open Food Facts is free and mirrorable.
                 
                  - Affiliate or coupon feeds, since accepting them destroys the trust position that is the entire reason this audience would install the app.
                  - 
