# Architecture

## Principle

The moat is not the model, it is the plumbing. Two free upstream sources with hard rate limits, one of which we do not control, have to serve thousands of users in a store with bad signal. That is a caching, scheduling and offline problem.

## Phase 1 - no backend at all

Ship as an installable PWA, not a native app. Barcode scanning works in the browser today and a PWA installs to the home screen with camera access. This avoids app store review, two codebases, the developer fee, and it lets us find out whether anyone wants this before paying for any of that.

- React plus TypeScript, single page
- - Barcode scan in browser, BarcodeDetector where available with a JS fallback
  - - Open Food Facts lookup direct from the client
    - - Price entered manually by the user
      - - All state in IndexedDB, no account, no server
        - - Service worker so the whole thing works offline in the aisle
         
          - Cost to run: zero.
         
          - ## Phase 2 - the read-through cache
         
          - This is where the retailer API arrives and where the interesting engineering starts.
         
          - ### Components
         
          - Edge: static PWA on S3 plus CloudFront.
         
          - API: Spring Boot on ECS Fargate behind an ALB. Endpoints are deliberately few: resolve barcode, get price for store plus product, search stores, submit receipt.
         
          - Cache: Redis for hot price lookups, keyed on locationId plus normalized productId. Postgres as the durable price cache and the system of record for user price history.
         
          - Product data: our own mirror of the Open Food Facts dump in Postgres, seeded from the full dump and updated from daily deltas by a scheduled job. Never call their live API on the request path.
         
          - ### The price cache is the whole design
         
          - Budget is 10,000 upstream calls per day. Grocery prices change weekly, not hourly.
         
          - - Read-through cache: on miss, call upstream, write to Redis and Postgres, return
            - - TTL of 12 to 24 hours on price, longer on aisle location, short on stock level
              - - Single-flight per cache key so a thundering herd on one popular item costs one upstream call
                - - Global token bucket in Redis to hard-cap daily upstream spend, with graceful degradation to last known price plus an as-of timestamp
                  - - Never show a stale price without showing its age
                   
                    - With a 24 hour TTL, 10,000 calls per day covers 10,000 distinct store-product pairs per day. Since users at the same store overlap heavily on staples, that supports a large user base. Measure the hit rate from day one and treat a falling hit rate as the scaling alarm.
                   
                    - ### Receipt pipeline
                   
                    - Asynchronous, never on the request path.
                   
                    - 1. Client uploads image to S3 via a presigned URL
                      2. 2. Event enqueues a job
                         3. 3. Worker runs OCR, then a per-retailer parser keyed on detected store
                            4. 4. Line items fuzzy matched against the product mirror and the user price history
                               5. 5. Low confidence matches queued for one-tap user confirmation, never silently accepted
                                  6. 6. Confirmed lines write to the price book
                                    
                                     7. Idempotency on receipt hash so a retried upload never double-writes.
                                    
                                     8. ## Data model, core tables
                                    
                                     9. - product: normalized barcode, name, brand, size, nutriments, nutriscore, nova, source, updated_at
                                        - - store: retailer, location_id, name, address
                                          - - price_observation: product_id, store_id, price, promo_price, unit_price, observed_at, source of api or receipt or manual
                                            - - user_price_entry: user_id, product_id, store_id, price, size, observed_at
                                              - - receipt: user_id, store_id, image_key, hash, status
                                                - - receipt_line: receipt_id, raw_text, matched_product_id, confidence, confirmed
                                                 
                                                  - Personal best price is a query over user_price_entry, not a stored field, so it is always correct.
                                                 
                                                  - ## Barcode normalization
                                                 
                                                  - One module, heavily unit tested, with a fixture of real barcodes.
                                                 
                                                  - - Accept UPC-A 12 digit and EAN-13 13 digit
                                                    - - Canonical internal form for the product mirror
                                                      - - Retailer-specific transform, for Kroger a 13 digit id with the check digit omitted
                                                        - - Log every miss with the raw scan so the fixture grows from real failures
                                                         
                                                          - ## Offline behaviour
                                                         
                                                          - The store is where the app is used and signal is bad there. Non-negotiable requirements:
                                                         
                                                          - - Full price book readable offline
                                                            - - Scans queue locally and sync later
                                                              - - Cached prices shown with their age
                                                                - - No feature that hard-fails without network
                                                                 
                                                                  - ## Privacy posture
                                                                 
                                                                  - No account required for the core app. Price history stays on device unless the user turns on sync. No third party analytics SDKs. If sync is enabled, store the minimum: product, store, price, timestamp.
                                                                 
                                                                  - This is not only ethics, it is the positioning. The audience installs this because it is not selling them anything.
                                                                 
                                                                  - ## Observability
                                                                 
                                                                  - - Upstream call count against the daily budget, alarmed at 70 percent
                                                                    - - Cache hit rate by source
                                                                      - - Barcode resolution failure rate, the leading indicator of a broken normalization layer
                                                                        - - Receipt parse success rate by retailer
                                                                          - - p50 and p99 on barcode resolve, which is the only latency users feel
                                                                           
                                                                            - ## Deliberate non-goals
                                                                           
                                                                            - No microservices. One service, one database, one cache until there is a reason.
                                                                           
                                                                            - No model inference on the request path in phase 1 or 2.
                                                                           
                                                                            - No native app until the PWA proves demand.
                                                                            - 
