# Roadmap

## Phase 1 - prove anyone wants it

Goal: a stranger scans something and comes back a second time.

Scope, roughly one weekend:

- Installable PWA, no account, works offline
- - Barcode scan
  - - Nutrition and ingredients from the Open Food Facts mirror
    - - Manual price entry
      - - The three value metrics: cost per serving, cost per gram of protein, fullness per dollar
        - - Local price book with personal best price
         
          - Out of scope: retailer API, receipts, swaps, photos, sync, accounts.
         
          - Validation before writing code: a landing page with three example scans. If a hundred people scan something in the first week, continue.
         
          - ## Phase 2 - make it feel like magic
         
          - Goal: the app knows the price before you type it, and the weekly receipt replaces daily logging.
         
          - - Kroger public API integration with the read-through cache
            - - Store picker via the Location API
              - - Price, promo price, aisle and stock level shown per store
                - - Receipt photo import for one retailer format, with confirmation queue
                  - - Pantry state derived from receipts
                    - - Rock-bottom price alerts
                     
                      - This is the phase that requires real engineering, and it is where the caching design in ARCHITECTURE.md earns its keep.
                     
                      - ## Phase 3 - make it worth paying for
                     
                      - - Affordable in-stock swap engine
                        - - Pantry-first cooking suggestions
                          - - Eating-out delta
                            - - Household mode with cost per person
                              - - CSV export
                                - - Additional retailers and receipt formats
                                  - - Produce and PLU support
                                   
                                    - One-time unlock ships here, around 5 to 8 USD.
                                   
                                    - ## Kill criteria
                                   
                                    - Write these down now so they are not rationalized away later.
                                   
                                    - - If fewer than 30 percent of people who scan once scan again within a week, the pain is not sharp enough. Stop.
                                      - - If barcode resolution fails more than 20 percent of the time on real US groceries after the normalization fixture is in place, the data foundation is too weak. Stop or change source.
                                        - - If cache hit rate cannot be held above 90 percent in phase 2, the free retailer tier will not scale and the economics do not work without a paid data deal.
                                          - - If receipt parsing accuracy for the first retailer cannot reach a level where users accept it without heavy correction, cut the feature rather than shipping a chore.
                                           
                                            - ## Distribution plan
                                           
                                            - Not influencers. Cal AI won that channel with paid spend we cannot match, and the target audience actively distrusts it.
                                           
                                            - Instead, show up where the behaviour already exists:
                                           
                                            - - Comment on the existing r/Frugal price book threads rather than launching. That community has 261 people commenting on a single price book post.
                                              - - r/EatCheapAndHealthy and r/povertyfinance, framed around cost per meal, never around weight.
                                                - - Position as the spreadsheet replacement, not as a Yuka or Cal AI competitor.
                                                  - - Skip Product Hunt. Research on comparable small tools found directories and launch sites underperformed personal outreach to niche communities.
                                                   
                                                    - ## Open questions
                                                   
                                                    - 1. Is cost per gram of protein the metric people actually respond to, or is cost per serving enough? Test both in the first week.
                                                      2. 2. Will people photograph a receipt weekly? This is the core behavioural bet of the whole product and it is unproven.
                                                         3. 3. Does the satiety estimate feel credible to users, or does it read as invented? Consider showing only the four inputs at first and adding the composite later.
                                                            4. 4. What does Kroger's terms of service actually permit for a consumer app, and is there a partner tier if the public tier is outgrown?
                                                               5. 5. Which retailer's receipt format is most standardized and worth building first?
                                                                  6. 6. Is manual price entry too much friction outside the Kroger banners, and if so does the app work at all for Costco and Aldi shoppers?
                                                                    
                                                                     7. ## Risks
                                                                    
                                                                     8. Retailer API access is revocable, and it is the single point of dependence for the magic. The manual price book must always work without it.
                                                                    
                                                                     9. Open Food Facts is donation funded and was publicly short of budget for 2026. Mirroring the dump removes the runtime dependency but not the long-term data dependency. Contributing labels back is both useful and self-interested.
                                                                    
                                                                     10. Receipt OCR is the hardest part and it is also the differentiator. There is a real chance it is not good enough, which is why phase 1 does not depend on it.
                                                                    
                                                                     11. Anything touching food and body weight can feed disordered eating. The deliberate absence of weight goals, calorie targets and streaks is a safety decision, not a scoping one, and should not be reversed for growth.
                                                                     12. 
