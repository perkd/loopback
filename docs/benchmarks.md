# Benchmarks

This document captures the current benchmark status for the centralized model registry and related model-registration paths, plus the highest-leverage optimization opportunities still visible in the codebase.

It is intended as a quick future reference, not as a replacement for the test suite.

## Scope

The most relevant benchmark coverage currently lives in:

- `test/centralized-model-registry-performance.test.js`

That suite exercises:

- load and stress behavior for high-volume model creation
- ownership-query latency for `DataSource` and `App` owners
- memory growth and cleanup behavior
- repeated-query cache behavior
- concurrent access and creation safety

## How To Run

Run the dedicated centralized-registry benchmark suite directly:

```sh
node "node_modules/mocha/bin/mocha.js" test/centralized-model-registry-performance.test.js --timeout 120000 --reporter spec
```

Notes:

- `yarn test` also covers the codepaths indirectly, but it is currently noisier because unrelated integration suites can still be flaky.
- `package.json` contains `test:performance`, but that script targets middleware performance, not the centralized registry benchmarks in this document.

## Current Status

As of the latest local run in this workspace:

- the centralized registry performance suite passed: `31 passing`
- runtime was about `4s`
- the benchmark regressions that previously failed on load, speed, and memory are now back within their test budgets

This is the important practical conclusion: the current implementation is performing well enough to satisfy the existing regression suite again.

## Latest Baseline Snapshot

These numbers are from the latest local run of `test/centralized-model-registry-performance.test.js`. They are machine-dependent and should be used as directional baselines, not universal guarantees.

### Load And Creation

- `1000+ DataSource models` created in about `461ms`
- `1000+ App models` created in about `1255ms`
- `500 DS + 500 App mixed` created in about `186ms`

### Ownership Query Speed

API comparison from the benchmark output:

- DS `getModels`: about `0.002ms avg`
- App `getModels`: about `0.018ms avg`
- DS `getNames`: about `0.009ms avg`
- App `getNames`: about `0.069ms avg`

Response-time benchmarks at increasing model counts also stayed low:

- at `1000` models:
  - DS `getModels`: about `0.16ms`
  - App `getModels`: about `0.05ms`
  - DS `getNames`: about `0.18ms`
  - `hasModel` and `getModel` remained effectively near-zero in the printed table

### Cache Efficiency

The cache-efficiency benchmark reported:

- first access: about `0.001ms avg`
- repeated access: about `0.000ms avg`
- mixed access: about `0.000ms avg`
- reported speedup factor: about `2.69x`

### Memory

Key memory observations from the benchmark output:

- `50 models`: about `3.27 MB` total, about `66.89 KB/model`
- `100 models`: about `6.6 MB` total, about `67.6 KB/model`
- `200 models`: about `13.13 MB` total, about `67.21 KB/model`
- `400 models`: printed as `NaN`, which indicates measurement/reporting noise rather than a confirmed runtime regression

Model-type memory efficiency:

- `simple-models`: about `64.34 KB/model`
- `complex-models`: about `691.28 KB/model`
- `relation-models`: about `70.61 KB/model`

## Regression Budgets Currently Enforced

The benchmark suite currently protects several important budgets.

### Memory Guardrails

- DataSource-owned cleanup growth after cleanup: `< 10MB`
- App-owned total growth after cleanup: `< 10MB`
- lifecycle attachment/detachment growth: `< 5MB`
- dynamic model growth after cleanup: `< 3MB`
- GC variance check: `<= 2MB`
- high-volume `1000` DataSource models: `< 50MB`
- average memory per model in the growth analysis: `< 500KB`
- per-model type efficiency sanity bound: `< 1MB/model`

### Speed Guardrails

- `1000+ App models` creation: `< 10s`
- high-volume app owner query: `< 200ms`
- mixed DS query: `< 150ms`
- mixed App query: `< 150ms`
- DS API `getModels` p95: `< 100ms`
- App API `getModels` p95: `< 150ms`
- DS API `getNames` p95: `< 50ms`
- App API `getNames` p95: `< 75ms`
- global `findModelByName` p95: `< 20ms`
- owner-specific `getModelForOwner` p95: `< 15ms`

## What Improved

The benchmark recovery came mainly from reducing unnecessary work in model registration and ownership lookups.

### 1. `app.model()` now avoids redundant registration work

Implemented change:

- datasource-backed models are no longer re-registered into `ModelRegistry` from `app.model()`

Why it helped:

- datasource attachment already registers those models
- the old behavior duplicated owner bookkeeping and cache invalidation work
- this mattered most under high-volume creation paths

Relevant code:

- `lib/application.js`

### 2. Junction-model auto-registration no longer runs for obvious no-op cases

Implemented change:

- `_autoRegisterJunctionModels()` is only scheduled when the model actually has declared relations

Why it helped:

- the old path queued unnecessary `setImmediate()` work for the common case of models with no relations
- that extra scheduling overhead showed up in bulk app-model creation

Relevant code:

- `lib/application.js`

### 3. Shared-method refresh no longer performs broad remoting rescans from global events

Implemented change:

- the shared-method refresh logic was moved away from broad app-level event-driven rescans and localized inside `app.model()`

Why it helped:

- it removed the worst repeated full-app reconfiguration behavior
- this was the biggest win for app-owned model creation throughput
- it directly addressed the earlier quadratic behavior under large model counts

Relevant code:

- `lib/application.js`
- previously in `lib/loopback.js`

### 4. `Registry.configureModel()` avoids unnecessary descendant scans

Implemented change:

- descendant checks now happen only when new remote methods are actually being added

Why it helped:

- it removes an avoidable scan from many configuration paths
- the benefit compounds when lots of models are configured in one run

Relevant code:

- `lib/registry.js`

### 5. Owner-aware caching improved repeated ownership queries

Implemented change:

- owner-aware cache paths back `getModelsForOwner`, `getModelNamesForOwner`, `getModelForOwner`, and related helpers

Why it helped:

- repeated lookups reuse cached arrays and name maps
- that is visible in both the API comparison and the cache-efficiency benchmark

Relevant code:

- `loopback-datasource-juggler` `ModelRegistry` integration used by this repo

## Where We Still Have Headroom

There is no urgent benchmark regression left in the centralized-registry suite, but there are still obvious places where the next round of gains would come from.

## Highest-Leverage Optimizations

These are ordered by likely payoff.

### 1. Reduce app-model remoting overhead during bulk registration

Why this is the top target:

- app-owned creation is still much slower than datasource-owned creation in the latest benchmark output
- the benchmark run still prints many `Warning: overriding remoting type responsetimeapp...` messages during the response-time benchmark
- that strongly suggests strong-remoting type/class registration is still a meaningful part of the remaining app-model cost

What to look at:

- `app.model()` remoting setup in `lib/application.js`
- repeated `defineObjectType` / `addClass` work
- whether internal benchmark-only or app-owned-but-not-remoted models can avoid the full remoting path

Expected payoff:

- best chance of improving `1000+ App models` creation time
- likely the largest remaining speed win in realistic high-volume scenarios

### 2. Make `refreshSharedMethodConfiguration()` incremental instead of whole-app

Why it still matters:

- the current implementation is much better than before, but it still loops `app.models()` when shared-method configuration is present
- that means the cost can still grow with model count in remoting-heavy apps

What to look at:

- `refreshSharedMethodConfiguration(app)` in `lib/application.js`
- whether only the newly attached model, or a narrower subset of configured models, needs recalculation

Expected payoff:

- protects against a second-order app-model creation slowdown in apps that heavily use `sharedMethods` config

### 3. Replace junction-model discovery scans with direct relation metadata

Why it matters:

- `_autoRegisterJunctionModels()` still loops through all datasource models for every relation
- that is effectively a relation-by-model scan

What to look at:

- `_autoRegisterJunctionModels()` in `lib/application.js`
- whether junction models can be identified directly from relation metadata instead of string-matching model names across `dataSource.models`

Expected payoff:

- best for relation-heavy apps
- reduces avoidable work in the attachment path even after the current “skip no-op models” fix

### 4. Reduce app-owner query overhead relative to datasource-owner queries

Why it matters:

- app ownership queries are still measurably slower than datasource ownership queries in the microbenchmarks
- they are absolutely fast, but the gap is still visible

What to look at:

- owner-type detection and app-owner cache lookup path in the registry
- whether app-owner cache structures can mirror the fastest datasource-owner path more closely

Expected payoff:

- smaller than remoting wins
- useful if app-owner queries become hot in large multi-app workloads

### 5. Reduce per-model memory cost for complex model definitions

Why it matters:

- `complex-models` are much heavier than simple or relation-only models in the printed memory-efficiency benchmark

What to look at:

- duplicate metadata storage for normalized property definitions
- remoting metadata attached per model
- whether expensive per-property derived structures can be lazily built

Expected payoff:

- more of a memory win than a speed win
- most relevant when applications generate many large definitions dynamically

## Things That Are Not Immediate Optimization Targets

These showed noise or minor gaps, but are not the first place to spend time.

### Memory-growth reporting noise

The `400 models` row in the growth report printed `NaN`.

Interpretation:

- this looks like observability instability from GC timing and metric formatting
- it is worth cleaning up for trustworthiness, but it is not evidence of a proven runtime regression by itself

### Datasource-name warning noise

The suite prints:

- `A datasource is created with name "db", which is different from the name in settings ("memory").`

Interpretation:

- this is benchmark output noise, not a demonstrated performance issue
- it should be cleaned up eventually to keep benchmark logs readable

## Practical Takeaway

Today’s benchmark picture is:

- load: healthy
- speed: healthy and back within enforced regression budgets
- memory: healthy enough for current guardrails, with the biggest remaining cost concentrated in complex model definitions

If future optimization work resumes, the best place to start is still app-owned model registration, especially remoting/type-registration churn.

## Related Files

- `test/centralized-model-registry-performance.test.js`
- `lib/application.js`
- `lib/registry.js`
- `docs/centralized model registry/centralized-model-registry.md`
