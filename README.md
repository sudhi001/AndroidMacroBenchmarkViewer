# Android Macrobenchmark Viewer

[![CI](https://github.com/sudhi001/AndroidMacroBenchmarkViewer/actions/workflows/ci.yml/badge.svg)](https://github.com/sudhi001/AndroidMacroBenchmarkViewer/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Read your [Android Macrobenchmark](https://developer.android.com/topic/performance/benchmarking/macrobenchmark-overview)
results properly — in the browser, with no upload.

Gradle prints a wall of numbers and leaves you to eyeball whether your change
made things slower. This answers that question directly: drop in two
`benchmarkData.json` files and get a per-metric verdict backed by a real
significance test, so you can tell an actual regression from a noisy device.

**[Open the app →](https://androidmacrobenchmarkviewer.onrender.com)**  ·  No install, no sign-up.

![Screenshot](screenshot.png)

---

## Contents

- [Quick start](#quick-start)
- [Getting a benchmarkData.json](#getting-a-benchmarkdatajson)
- [The three views](#the-three-views)
- [Reading a comparison](#reading-a-comparison)
- [Metric glossary](#metric-glossary)
- [Getting numbers worth trusting](#getting-numbers-worth-trusting)
- [Sharing and exporting](#sharing-and-exporting)
- [Privacy](#privacy)
- [FAQ](#faq)
- [Running locally](#running-locally)
- [How it works](#how-it-works)
- [Contributing](#contributing)

---

## Quick start

**Never used it before?** Open the app and click **Load sample data**. Four
realistic runs load, and the Compare tab shows a startup regression and a
hidden jank regression. Nothing to download.

**Have your own results?**

1. Open [the app](https://androidmacrobenchmarkviewer.onrender.com)
2. Drag your `benchmarkData.json` onto the page — or drop the whole output
   folder and it will find them
3. **Inspect** shows everything in that run
4. Drop a second file, mark one **Baseline** and one **Candidate**, and open
   **Compare**

That's the whole workflow. There is nothing to configure.

---

## Getting a benchmarkData.json

If you already run Macrobenchmarks, skip to [finding the file](#find-the-file).

### 1. A benchmark module

Macrobenchmarks live in their own module using the `com.android.test` plugin,
measuring your real app from the outside:

```kotlin
// macrobenchmark/build.gradle.kts
plugins {
    id("com.android.test")
    id("org.jetbrains.kotlin.android")
}

dependencies {
    implementation("androidx.benchmark:benchmark-macro-junit4:1.4.1")
}
```

> `1.4.1` is the current stable release at the time of writing — check the
> [Benchmark release notes](https://developer.android.com/jetpack/androidx/releases/benchmark)
> for the latest.

### 2. A benchmark

Startup:

```kotlin
@RunWith(AndroidJUnit4::class)
class StartupBenchmark {
    @get:Rule val rule = MacrobenchmarkRule()

    @Test
    fun startup() = rule.measureRepeated(
        packageName = "com.example.app",
        metrics = listOf(StartupTimingMetric()),
        iterations = 10,              // 10+ — see "numbers worth trusting"
        startupMode = StartupMode.COLD,
    ) {
        pressHome()
        startActivityAndWait()
    }
}
```

Scrolling / jank:

```kotlin
@Test
fun scrollFeed() = rule.measureRepeated(
    packageName = "com.example.app",
    metrics = listOf(FrameTimingMetric()),
    iterations = 10,
    startupMode = StartupMode.WARM,
) {
    startActivityAndWait()
    device.findObject(By.res(packageName, "feed")).fling(Direction.DOWN)
}
```

### 3. Run it

```bash
./gradlew :macrobenchmark:connectedBenchmarkAndroidTest
```

On a **physical device**, against a **release or profileable** build. Emulator
numbers do not represent real hardware.

### Find the file

Gradle writes it under the benchmark module's build output. The variant and
device folders vary, so the reliable way to find it is:

```bash
find . -name "*-benchmarkData.json" -mmin -60
```

Typical location:

```
macrobenchmark/build/outputs/connected_android_test_additional_output/<variant>/<device>/
```

Drop that file — or its parent folder — onto the app.

---

## The three views

| View | Answers | Needs |
|---|---|---|
| **Inspect** | *Where is the time going in this run?* | 1 run |
| **Compare** | *Did my change make it slower?* | 2 runs |
| **Trend** | *Is it drifting over time? Is this benchmark flaky?* | 3+ runs |

### Inspect

Every benchmark and every metric — including `sampledMetrics`, which most
viewers ignore. For each metric you get min / median / mean / max, **P90 / P95 /
P99**, standard deviation, and a **CV** column showing how reproducible the run
was.

Click **Distribution** on any row for two charts:

- **Per iteration** — a rising line means the device drifted during the run
  (warmup not finished, or thermal throttling)
- **Distribution within each iteration** — for frame timing, the outliers
  above the whiskers *are* your janky frames

It also surfaces what the Gradle console buries: warmup and repeat iteration
counts, thermal throttle sleep, total run time, and parameterized variants
(`startup[mode=COLD]` and `startup[mode=WARM]` are kept separate).

At the top, a **Run quality** panel warns about anything that undermines the
numbers — unlocked CPU clocks, thermal throttling, high variance, or a run with
only one iteration.

### Compare

Pick a **Baseline** (usually `main`) and a **Candidate** (your branch). Every
metric is joined by benchmark and metric name, then judged.

Thresholds are adjustable under **Thresholds** and persist in your browser:

| Threshold | Default | Meaning |
|---|---|---|
| Minimum change | 5% | Smaller deltas are called unchanged |
| Significance (α) | 0.05 | Maximum p-value for a verdict |
| Max baseline CV | 10% | Above this the baseline is too noisy to judge against |
| Minimum iterations | 5 | Fewer than this per side gives no verdict |

### Trend

Drop several runs, or a folder. Each metric is charted across them with a P90
band. `benchmarkData.json` carries **no timestamp**, so ordering comes from file
modification time — rename any run inline if the order looks wrong. Metrics that
are consistently irreproducible are flagged **flaky**, because a trend line
through noise is meaningless.

---

## Reading a comparison

### Verdicts

| Verdict | What it means | What to do |
|---|---|---|
| 🔴 **regressed** | Beyond your threshold *and* statistically real | Investigate — this one is genuine |
| 🟢 **improved** | Same, in the good direction | Take the win |
| ⚪ **unchanged** | Within the threshold | Nothing — but check for a `tail` badge |
| 🟡 **inconclusive** | Too few iterations, or the baseline is not reproducible | Raise `iterations`, or re-run on a quieter device |
| ⚪ **baseline-only / candidate-only** | Benchmark exists on one side only | Usually a renamed or deleted benchmark |

### The columns

- **Δ median** — the headline number
- **Δ P90 / Δ P99** — the tail. A regression can hide entirely here
- **p** — probability of seeing this difference if nothing actually changed.
  Below α means it is unlikely to be noise
- **Cliff's δ** — effect size, −1 to +1. A change can be statistically
  detectable and still too small to care about; this is how you tell

### Worked example

Click **Load sample data** and open **Compare** to see exactly this:

| Benchmark / metric | Baseline | Candidate | Δ median | Δ P90 | Δ P99 | p | Cliff's δ | Verdict |
|---|---|---|---|---|---|---|---|---|
| startup / `timeToInitialDisplayMs` | 302.0 ms | 335.5 ms | **+11.1%** | +12.2% | +12.7% | 0.0000 | 1.00 | 🔴 regressed |
| scroll / `frameDurationCpuMs` | 6.04 ms | 6.24 ms | +3.22% | +13.3% | +26.5% | 0.0091 | 0.70 | ⚪ unchanged · 🟡 `tail P95` |
| scroll / `frameCount` | 201.08 | 200.51 | −0.28% | −0.42% | −1.69% | 0.3847 | −0.24 | ⚪ unchanged |

Row 1 is a clean regression: startup got 11% slower, p is effectively zero, and
the effect size is maximal.

**Row 2 is the interesting one.** The median moved only 3.22%, so the verdict is
*unchanged* — but P95 doubled and P99 moved +26.5%. A handful of dropped frames
barely shifts the median of two thousand samples. That is what a jank regression
looks like, and a median-only comparison reports it as fine. The **`tail`
badge** exists to stop you scrolling past it. Click the verdict to see the
explanation and the underlying percentiles.

Row 3 is genuinely nothing: tiny delta, high p-value, negligible effect.

---

## Metric glossary

The parser never hardcodes metric names, so anything your AGP version emits will
show up. These are the common ones:

### Startup — `StartupTimingMetric()`

| Metric | Meaning |
|---|---|
| `timeToInitialDisplayMs` | Launch until the first frame is drawn (**TTID**) |
| `timeToFullDisplayMs` | Launch until your call to `reportFullyDrawn()` (**TTFD**). Only appears if you call it |

### Frames — `FrameTimingMetric()`

| Metric | Meaning |
|---|---|
| `frameDurationCpuMs` | CPU time to produce one frame. Watch **P95/P99**, not the median |
| `frameOverrunMs` | How far a frame missed its deadline. **Negative is good** — it finished with time to spare. Rising toward 0 means you are running out of headroom |
| `frameCount` | Frames produced during the measured block |

### Memory — `MemoryUsageMetric()`

| Metric | Meaning |
|---|---|
| `memoryHeapSizeMaxKb` | Peak Java heap |
| `memoryRssAnonKb` | Anonymous resident memory — your allocations |
| `memoryRssFileKb` | File-backed resident memory — code and mapped files |

### Units and direction

Units are inferred from the name suffix — `Ms`, `Ns`, `Us`, `Sec`, `Count`,
`Bytes`, `Kb`, `Mb`, `Percent`, `Hz`, `Frames` — including aggregate suffixes
like `memoryHeapSizeMaxKb`. Everything is treated as **lower-is-better**, which
is right for essentially every Macrobenchmark metric, except names matching
`fps`, `framerate`, `throughput`, `hitrate` or `score`.

---

## Getting numbers worth trusting

Most confusing benchmark results are measurement problems, not code problems.

| Do | Why |
|---|---|
| Use a **physical device** | Emulator timings do not reflect real hardware |
| Benchmark a **release / profileable** build | Debug builds are not representative |
| Use **10+ iterations** | Below 5 per side no verdict is given at all |
| **Lock CPU clocks** if rooted (`androidx.benchmark.lockClocks`) | Frequency scaling is the single largest source of run-to-run noise |
| Let the device **cool** and keep it plugged in | Thermal throttling silently skews later iterations |
| **Close background apps** | Anything else running is noise in your result |
| Use the **same device** for baseline and candidate | Cross-device deltas measure the hardware, not your change |

The app checks most of this for you and says so in the **Run quality** panel.
Comparing runs from two different devices produces a loud warning.

### Understanding the CV column

**CV (coefficient of variation)** answers: *if I ran this again, how close would
the number be?* Under ~10% is good; above that, deltas smaller than the CV are
not meaningful.

This is measured **between iterations**, not across all pooled samples — an
important distinction for frame timing. The pooled spread of
`frameDurationCpuMs` is often ~50% simply because frames legitimately differ
from one another. That says nothing about reproducibility. Its between-iteration
CV is typically ~2%, and that is the number this tool shows.

---

## Sharing and exporting

| Action | Produces | Good for |
|---|---|---|
| **Copy share link** | A URL containing the data, gzipped into the fragment | Pasting into Slack or a PR comment |
| **Export HTML report** | One self-contained file — no scripts, no network | Attaching to a PR, or reading offline |
| **Export CSV** | Every metric, or every comparison row | Spreadsheets and further analysis |

The share link is scoped to what you are looking at (the selected run, or the
comparison pair), because a URL fragment tops out around 30,000 characters and a
realistic pair already uses most of it. If your data is too large, the app says
so and points you at the HTML export instead of producing a broken link.

---

## Privacy

Everything happens in your browser. There is no backend, no analytics and no
telemetry — after the page loads, the app makes no network requests at all.

Share links put the data after the `#` in the URL. Browsers **never transmit the
fragment to the server**, so even a shared link keeps your data between the
people you send it to. You can verify all of this in DevTools → Network.

---

## FAQ

**My percentiles differ slightly from the Gradle console.**
Expected. This uses linear interpolation (the NumPy/R "type 7" definition);
`androidx.benchmark` picks a nearest rank. Differences show up in the last
decimal. If your file already contains `P50`/`P90`/`P95`/`P99`, those reported
values are used as-is instead.

**Everything says "inconclusive".**
Either fewer than 5 iterations per side, or the baseline's between-iteration CV
is above 10%. Raise `iterations`, and see
[numbers worth trusting](#getting-numbers-worth-trusting). This is deliberate —
a false green is worse than no answer.

**A metric says "unchanged" but has a `tail` badge.**
The median held, but a high percentile moved much further. For frame timing that
usually *is* the regression. Click the verdict for the breakdown.

**"Nothing happened when I dropped my file."**
Check the red error panel — the app reports parse failures with a reason. It
does not filter by MIME type, so any `.json` will at least be attempted.

**Can I use this in CI to fail a PR?**
Not yet — see [not included](#not-included).

**Does it work offline?**
Once loaded, yes. Exported HTML reports work offline too.

---

## Running locally

```bash
git clone https://github.com/sudhi001/AndroidMacroBenchmarkViewer.git
cd AndroidMacroBenchmarkViewer
npm install
npm run dev
```

Open http://localhost:5173. Node 20.19+ or 22.12+ required.

| Command | Does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm test` | Run the test suite |
| `npm run typecheck` | TypeScript, no emit |

### Deploying your own

It is a static site. Build with `npm ci && npm run build` and serve `dist/`.
No server-side component, no environment variables.

---

## How it works

```
src/core/            Pure TypeScript. No DOM, no React. Unit-tested.
  parse.ts             benchmarkData.json -> normalized model
  stats.ts             percentiles, CV, Mann-Whitney U, Cliff's delta
  compare.ts           baseline vs candidate -> verdicts
  trend.ts             N runs -> per-metric series
  share.ts             gzip + base64url for the URL fragment
  export/              CSV and self-contained HTML
src/web/             React UI
public/fixtures/     Sample data, also used by the tests
```

**The parser is deliberately tolerant.** It iterates whatever metrics a file
contains rather than naming any, so new AGP metrics work without a code change.
Missing sections and unknown fields degrade into a visible warning instead of a
blank page.

### Notes on the statistics

- **Significance is a two-sided Mann-Whitney U test over per-iteration medians.**
  Frames within a single iteration are correlated, so testing over ~2000 pooled
  raw samples would report p ≈ 0 for a change of no practical size. Collapsing
  to one value per iteration keeps *n* honest. Mann-Whitney is used rather than
  a t-test because benchmark samples are small, skewed and outlier-prone.
- **Cliff's δ** reports effect size independently of *n*, which is what stops a
  detectable-but-trivial change from being reported as a regression.
- **Noise gating uses between-iteration CV**, for the reason described
  [above](#understanding-the-cv-column).

---

## Not included

There is no CLI or GitHub Action yet, so this cannot fail a PR on regression by
itself — export the HTML report and attach it to the PR instead. `src/core/` has
no DOM dependencies precisely so a CLI can be added without a rewrite.
Contributions welcome.

---

## Contributing

Issues and pull requests are welcome. `npm test` and `npm run typecheck` must
pass; CI runs both on every PR.

Especially useful:

- **Real `benchmarkData.json` files** from AGP versions not covered by
  `public/fixtures/` — the parser is only as good as the shapes it has seen
- A **CLI** wrapping `src/core/` for CI use
- Metric glossary entries for metrics not documented above

---

## License

[MIT](LICENSE)
