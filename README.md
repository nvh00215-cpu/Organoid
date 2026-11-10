# Organoid

**A mechanistic, multi-organ tissue simulator with a live agent swarm, built for preclinical dose-toxicity triage.**

> Formerly "Digital Liver". The project started as a liver-lobule simulator and grew into a multi-organ system (liver, kidney, heart, brain) with a shared plasma compartment and an LLM-backed agent layer.

> **Scope warning.** Organoid is a triage and screening aid. It is not diagnostic, not a clinical tool, and not a replacement for in vitro, animal or human studies. All rate constants and thresholds are illustrative and uncalibrated against experimental data. Do not use its output to make dosing or safety decisions.

---

## Table of contents

1. [What it is](#what-it-is)
2. [Objective](#objective)
3. [Design principles](#design-principles)
4. [Architecture](#architecture)
5. [The organs](#the-organs)
6. [Shared plasma and organ coupling](#shared-plasma-and-organ-coupling)
7. [The agent swarm](#the-agent-swarm)
8. [Verdicts and headline labels](#verdicts-and-headline-labels)
9. [The dashboard](#the-dashboard)
10. [Getting started](#getting-started)
11. [Configuring the LLM proxy](#configuring-the-llm-proxy)
12. [Testing and determinism](#testing-and-determinism)
13. [Repository layout](#repository-layout)
14. [Limitations](#limitations)
15. [Roadmap](#roadmap)
16. [History](#history)

---

## What it is

Organoid simulates how a compound moves through a body and injures tissue over time. A dose enters a one-compartment plasma model. Each organ reads the shared plasma exposure and runs its own mechanistic model. A verdict layer turns the organ results into a plain-language status. On top of that, a swarm of per-organ agents can observe the running simulation, describe what they see, and (for the liver only) propose bounded parameter changes.

The core simulation is **deterministic, client-side, and free of machine learning**. There are no black-box surrogates, no random number generators, and no backend needed to run it. The LLM layer is optional and sits strictly on top; it can describe and narrate, but it can never override the engine's verdict.

## Objective

Give a researcher a fast, inspectable first look at questions like:

- At what dose and schedule does a compound start to injure the liver, and by which pathway (acute or chronic)?
- Do the kidney and heart cross their own risk thresholds at the same exposure?
- How does repeated dosing change the picture compared with a single dose?
- What happens when organs feed back into shared clearance?

The goal is **triage**: ranking and flagging scenarios worth deeper study, with every step of the reasoning visible in the mechanism rather than hidden in a trained model.

## Design principles

| Principle | What it means in practice |
|---|---|
| **Mechanistic, not statistical** | Every output traces back to ODEs and named constants. |
| **Deterministic** | Same inputs give byte-identical results. Golden SHA-256 snapshots guard this. |
| **Engine is the authority** | Verdict labels come only from the engine. Agents and the narrator cannot change them. |
| **LLMs describe, bounded actions only** | Agent replies are validated with zod. Only whitelisted liver parameters can be adjusted, and values are clamped. |
| **No secrets in the client** | The API key lives server-side only and never enters the browser bundle. |
| **Additive evolution** | New behaviour is opt-in, and existing results and goldens never change. |

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│ UI (React + Vite)   src/App.tsx, src/components/             │
│ dose panel · hex-grid canvas · verdict cards · gauges · charts│
├──────────────────────────────────────────────────────────────┤
│ Swarm layer          src/swarm/                              │
│ SwarmEngine · organ agents · SwarmRunner · narrative         │
│ orchestrator · budgets · clamp · transcripts                 │
├──────────────────────────────────────────────────────────────┤
│ Deterministic core   src/model/                              │
│ plasma PK · liver lobule ODEs · kidney · heart · brain ·     │
│ verdicts · systemic plasma · resumable stepwise engine       │
├──────────────────────────────────────────────────────────────┤
│ Optional dev proxy   src/server/organProxy.ts (Vite plugin)  │
│ /api/organ · /api/narrative  → upstream LLM API              │
└──────────────────────────────────────────────────────────────┘
```

**Core (`src/model/`)** holds the physics. It is the most conservative part of the codebase: changes are additive, flag-gated, and checked against golden hashes.

**Swarm (`src/swarm/`)** wraps the core in a live, steppable engine and attaches agents to each organ.

**Proxy (`src/server/`)** is a Vite dev-server plugin that forwards validated requests to an upstream model API so the browser never sees the key.

## The organs

### Liver: the lobule model

Each simulated agent is one **hepatic lobule**, a functional unit of roughly 10^5 hepatocytes, not a single cell. Lobules sit on a **24 × 32 hex lattice (768 hexes)**. Inside each lobule an internal **Zone 1 → Zone 2 → Zone 3** gradient captures the oxygen and metabolic gradient along the sinusoid.

Two injury pathways run together:

1. **Acute, CYP-driven Zone 3 necrosis.** Metabolic activation concentrates toxic metabolite in Zone 3. Necrosis there spreads as a localized wave through neighbor coupling (the same neighbor-stress pattern applies when a neighbor's injury exceeds a threshold).
2. **Chronic, diffuse attrition.** Sustained metabolite load slowly wears down tissue and suppresses repair, producing degeneration without a sharp necrotic front.

Liver outcomes map to seven status labels: `SAFE`, `CAUTION`, `TOXIC`, `CHRONIC DEGENERATION`, `CHRONIC LIVER FAILURE`, `LIVER FAILURE`, and `ACUTE + CHRONIC FAILURE`.

### Kidney: spatial nephron model

A per-hex spatial model with three arrays: **cortex** (filtrate), **medulla** (concentrated filtrate) and **damage** (0 to 1).

- Filtrate delivery follows GFR, derated by congestion.
- The cortex washes out; the medulla concentrates (concentration factor scales with a compound-specific `kidneyScale`).
- Damage is driven by medullary excess above `MEDULLA_THRESHOLD`, offset by slow regeneration and increased by neighbor-congestion stress.
- Kidney clearance feeds back into plasma only when coupling is enabled.

Headline rules: `RENAL FAILURE` when peak mean damage exceeds 0.7 or the injured fraction exceeds 0.55; `RENAL RISK` when peak mean damage exceeds 0.12 or peak medullary concentration exceeds the threshold; otherwise `KIDNEY CLEAR`.

**Depth indices** (derived from recorded frames, informational only):

- **Cortical load index.** Measures cortical filtrate stress above `CORTEX_THRESHOLD`. The model never injures the cortex, so this is load, not damage.
- **Recovery index.** Damage-weighted measure of how much of each hex's peak damage has recovered. `1.0` means intact or fully recovered.

### Heart: hERG-driven compartment

A zero-dimensional model with a scalar damage state. hERG channel blockade is algebraic in the plasma exposure fold (saturating, scaled by a compound-specific `heartScale`). Damage accumulates only while blockade exceeds `HERG_THRESHOLD`, with slow recovery.

Headline rules: `CARDIAC FAILURE` when peak damage exceeds 0.4; `CARDIAC RISK` when it exceeds 0.08; otherwise `HEART CLEAR`.

**Depth indices** (informational only):

- **QT load.** Integrated blockade above threshold, plus the fraction of the run spent above it. This captures the reversible electrical burden, separate from cumulative injury.
- **Washout index.** How much of the peak blockade has washed out by a given time.

### Brain: barrier-limited exposure

A lighter model in which brain concentration is limited by the barrier and injury develops only when barrier-limited concentration crosses an injury line. It produces `NEURO FAILURE`, `NEURO RISK` or `BRAIN CLEAR`. The brain is the least developed organ: it has thresholds and gauges but no dedicated agent and no feedback into clearance.

### Compounds

Built-in compounds include acetaminophen (APAP) and ibuprofen, plus a **custom** compound whose organ scales derive from a CYP-activation parameter. Each compound carries scales for the kidney and heart, so the same plasma exposure produces different organ stress per compound.

## Shared plasma and organ coupling

- **Pharmacokinetics.** One compartment. A dose enters as a bolus (single or repeated every 24 h). Elimination is first-order plus saturable Phase II metabolism.
- **Exposure fold.** Plasma concentration divided by a typical-dose reference, so organs compare fold-over-label rather than raw mg/L. One global fold feeds the kidney, heart and brain.
- **Organ coupling (opt-in).** When enabled, kidney, heart and brain add extra first-order clearance of parent drug. This lowers plasma and therefore injury downstream.
- **Systemic metabolite loop (opt-in).** A flag-gated metabolite pool: production comes from liver Zone 3 and kidney terms, elimination scales with remaining kidney function plus a decay term, and retained metabolite feeds back into the kidney's medullary burden. This creates a hepatorenal-style loop. The pool is bounded by a documented ceiling and the explicit-Euler step is stable by construction. With the flag off, results are bit-identical to the base model.

## The agent swarm

The swarm layer lets one agent per organ observe the live simulation and report on it.

### Engine

`SwarmEngine` wraps the resumable stepwise simulator and exposes:

- `runUntil(tick)` and `runToEnd()`: advance the simulation.
- `fork()`: branch a run so alternatives can diverge from a shared history.
- `setParam(...)`: change a whitelisted parameter from the current tick forward, leaving scheduled dosing untouched.

Resume tests prove that stepping one tick at a time, in 50-tick segments, or all at once gives identical results.

### Organ agents

| Agent | Sees (validated numbers only) | Can act? |
|---|---|---|
| **Liver** | tick, time, necrosis and chronic-load summaries, zone figures | Yes, but only on whitelisted liver parameters, clamped to safe ranges |
| **Kidney** | medulla mean, damage mean, injured fraction, cortex mean, plus cortical load and recovery | No, describe only |
| **Heart** | hERG blockade, damage, plus QT load, time fraction and washout | No, describe only |

Each agent exists in two forms: a **mock** agent (deterministic, used in tests and offline) and a **real** LLM-backed agent that calls the local `/api/organ` proxy.

### Safety rails

- **Zod validation both ways.** Vitals are summarized from engine output and validated before prompting; replies are validated before use.
- **Clamp whitelist.** Only liver parameters and the brain efflux gain can be changed, and every requested value is clamped. The transcript records both what the model *requested* and what was *applied*.
- **Fallbacks.** An invalid, failed or timed-out reply falls back to a deterministic band-based classifier, so the run never stalls.
- **Distress bands.** Each organ maps vitals to `Distress` levels through fixed bands; new informational vitals never affect those bands.
- **Shared call budget.** A single budget caps total LLM calls and reserves capacity for the final checkpoint.
- **No client text in prompts.** Prompts are built only from validated numeric and enum fields.
- **Brain efflux action.** The opt-in brain agent may set only `kBrainEfflux` (blood-brain-barrier efflux gain, 1 is neutral), bounded to 0.5–2.0 and rate-limited to 0.1 per checkpoint so changes act slowly. Bounds and rate are illustrative and uncalibrated. Rejected params record nothing; the transcript keeps the pre-clamp `requested` value on brain entries.

### SwarmRunner and transcripts

`SwarmRunner` drives a run, calling the agents in parallel at **checkpoints**: on a fixed schedule and whenever the necrosis crosses a band boundary. It produces a **JSON-safe, replayable transcript** that records every agent reply, clamp, fallback and narrative entry, and replays exactly.

### Narrative orchestrator

At each checkpoint the orchestrator can produce one plain-English sentence describing the overall state. It receives only the engine's headline label, the time, and the organ distress levels (liver, kidney and heart, plus brain when the opt-in brain agent is enabled). The label is restricted to the exact set of strings the engine can produce, which is enforced by a schema and a drift-guard test. If the call fails or the budget is spent, a deterministic template sentence is used. The narrator cannot change the engine's label, and tests prove it.

## Verdicts and headline labels

The overall headline is either `NO ORGAN THRESHOLD CROSSED` or the labels of every organ that crossed a threshold, joined with ` · `. For example: `TOXIC · RENAL RISK · CARDIAC RISK · NEURO RISK`. Only the "hot" variants appear in a headline; `SAFE` and the `*_CLEAR` labels do not.

## The dashboard

A clinical-style web dashboard with:

- Dose panel (compound, dose, single or repeated schedule, horizon, coupling toggle).
- Hex-grid canvas with playback and per-lobule Z1 / Z2 / Z3 inspection.
- Verdict cards and per-organ gauges with thresholds.
- Time-series charts for plasma, necrosis, chronic load and organ metrics.
- A roadmap screen and a limitations screen.

The systemic metabolite loop and swarm visibility of shared plasma are not yet exposed in the UI.

## Getting started

Requirements: Node.js 20 or newer.

```bash
npm install
npm run dev      # start the dashboard and the dev proxy
npm run build    # type-check and produce dist/
npx tsc -b       # type-check only
npx vitest run   # run the full test suite (about 25 s)
```

The simulation runs entirely in the browser. The LLM agents and narrator are optional and need the proxy configured below.

## Configuring the LLM proxy

1. Create `.env.local` in the project root (it is gitignored).
2. Add your upstream API key under the variable name the proxy reads (see `src/server/organProxy.ts` and `vite.config.ts`). **Do not prefix it with `VITE_`**, because Vite exposes `VITE_` variables to the browser bundle.
3. Run `npm run dev`.

Proxy behaviour:

- Endpoints: `/api/organ` (discriminated union on liver, kidney, heart and brain) and `/api/narrative`.
- The key appears only in the upstream `Authorization` header and is never logged or returned.
- Requests are size-capped and validated before anything is sent upstream; upstream calls time out after 25 s; output is capped.
- Every error response is a short fixed message, with no upstream body or stack trace.

> The proxy is a Vite dev-server plugin. It exists only under `npm run dev`. A deployed static build has no `/api/*` routes, and would need a real backend or serverless function before the LLM features could be used.

Before publishing a build, check that the key does not appear in `dist/assets/*.js`.

## Testing and determinism

The suite covers the model, swarm and proxy layers, all passing:

- **Golden snapshots.** SHA-256 hashes of canonical results for fixed scenarios, including a coupled run, depth-index runs and metabolite-loop runs. Fixtures live in `src/swarm/__fixtures__/` and are **never regenerated**. New fixtures are created only for new behaviour, by a create-only writer (`WRITE_FIXTURES=1`).
- **Resume identity.** 1-step, 50-step and all-at-once runs match; mid-run `setParam` applies only from the current tick; forks diverge cleanly and share history.
- **Runner tests.** Scheduling, parallelism, invalid-reply fallbacks, clamping, budget reservation, replay, and label provenance.
- **Threshold drift guards.** Constants mirrored between the model and the swarm layer are pinned by tests.
- **Flag-off equivalence.** With optional flags absent, false or undefined, results are hash-identical to the base model.

## Repository layout

```
src/
  model/        deterministic core: ODEs, PK, kidney, heart, brain, verdicts
  swarm/        engine, agents, prompts, vitals, runner, orchestrator, tests
    __fixtures__/   golden snapshots (never regenerate)
  server/       Vite dev-server LLM proxy
  components/   dashboard UI
  App.tsx
scripts/        manual helper for exercising the organ proxy
```

## Limitations

- **Not a clinical tool.** Output is for triage and hypothesis generation only.
- **Uncalibrated constants.** Rate constants, thresholds and compound scales are illustrative and have not been fitted to experimental data.
- **Lobule resolution.** The liver agent is a functional unit, not a cell; intracellular detail is not modelled.
- **Simplified PK.** One plasma compartment with bolus dosing; no distribution to tissue compartments, no protein binding, no route-of-administration detail.
- **Brain is minimal.** It is a barrier-limited exposure model with thresholds, without dedicated agent support.
- **Depth indices are descriptive.** Cortical load, QT load and the recovery and washout indices are derived from recorded frames. They do not feed back into the dynamics or into verdicts.
- **Parent-drug coupling is small.** Extra clearance from organ coupling is roughly 10 to 20 percent of intrinsic clearance.
- **LLM agents are advisory.** They describe and propose bounded liver changes; they do not decide verdicts.
- **Dev-only proxy.** LLM features require the Vite dev server.

## Roadmap

- Expose the metabolite loop and coupling controls in the dashboard.
- Give the kidney and heart agents visibility of shared plasma and metabolite state.
- Digital-human screen: shared plasma network with multi-organ crosstalk in one view.
- Further kidney and heart depth inside the dynamics (not only derived indices).
- Calibration against published data for a small set of reference compounds.
- A deployable backend for the LLM proxy.

## History

The repository began from two plans: an AI-surrogate and 3D-blob hackathon plan (FastAPI, PINN, React Three Fiber, never built) and the lobule-approach plan that was actually implemented. The shipped direction is pure mechanistic ODEs, client-side, with no ML black boxes. Scope then grew from liver-only to multi-organ, and an agent swarm was layered on top, in stages: organ vitals, prompts and agents; the runner, narrator and hardened proxy; kidney and heart depth; and the opt-in shared plasma coupling with a systemic metabolite loop. The project was renamed from Digital Liver to Organoid.
