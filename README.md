# pricebook

A grocery app that answers three questions in one scan: what does this cost at my store, what is actually in it, and will it keep me full.

Status: product design. No code yet.

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

The metric is cost per gram of protein, calories per dollar, and fullness per dollar. That reframes food scanning away from moral judgment and away from obsessive counting, toward value.

No good or bad labels anywhere. Nutri-Score and NOVA appear as cited third party classifications with a link to their methodology, never as our verdict.

## What makes it defensible

The price book. Your own scan and receipt history becomes a personal record of the lowest price you have ever paid for every item, across every store including ones with no API. It gets more useful the longer you use it and it is not transferable, so retention comes from accumulated value rather than lock-in.

This technique already has organic demand. A post titled I stopped chasing every deal and built a personal price book has 5,624 upvotes and 261 comments, and its author cut grocery costs 25 percent using a Google Sheet. People are asking for price book apps and Product Hunt returns essentially nothing.

## Docs

- docs/PRODUCT.md - features, user flows, what we deliberately do not build
- - docs/DATA_SOURCES.md - verified free data sources and their limits
  - - docs/ARCHITECTURE.md - system design and caching strategy
    - - docs/COMPETITIVE.md - research findings with sources
      - - docs/ROADMAP.md - three phases, kill criteria, open questions
        - 
