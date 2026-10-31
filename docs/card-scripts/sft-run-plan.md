# SFT run plan: card-script drafting model (#2551, step 3a)

**Status: plan only. No training has been run, no GPU was rented, no money was
spent.** This document exists so Alex can approve (or reject) a short SFT
pilot without further research. Steps 1 (dataset export, #2856) and 2
(preference pairs, #2868) are merged; this is the explicitly gated sub-step
"estimate GPU hours and cost before launching and check with Alex before any
run past a short pilot".

Every GPU-hour and cost figure below is an **ESTIMATE**, with its assumptions
and source named. None of them is a measurement: no run happened.

---

## 1. Dataset (measured by the repo's own export)

Command, run from the repository root:

```sh
npx tsx scripts/export-card-script-dataset.ts --dry-run
```

Output, verbatim:

```
card scripts: 334 training pairs, 20 held-out gold pairs
train: /home/hatch/workspace/fixtrees/planar-nexus-worker-2551/dataset-out/train.jsonl
eval:  /home/hatch/workspace/fixtrees/planar-nexus-worker-2551/dataset-out/eval.jsonl
dry run: nothing written
```

(The same run with `--out <dir>` writes `train.jsonl` and `eval.jsonl`; that
directory is a local artifact and is not committed.)

| Split                          | Records | Source                                                                                |
| ------------------------------ | ------- | ------------------------------------------------------------------------------------- |
| train                          | **334** | every accepted script in `src/lib/game-state/card-scripts/cards/` except the gold set |
| eval                           | **20**  | the #2514 bake-off gold set (`scripts/data/bakeoff-cards.json`)                       |
| total accepted scripts on disk | **354** | 334 + 20; `ls src/lib/game-state/card-scripts/cards/*.json \| wc -l` = 354            |

Cross-check: the export fails loudly if a gold card reaches the training file
or if the number of scripted gold cards differs from the gold list length, so
"334 / 20 / 354" is the repo's own count, not a hand tally.

### What the records look like

One ETF record per line (`scripts/card-scripts/dataset-lib.ts`): `system` is
the drafting op-set description, `user` is the oracle text, `assistant` is the
script JSON (validated against `CardScriptSchema`). The gold set never
reaches the training split.

ETF compatibility was checked against brewery-ai's public schema
(`src/brewery_ai/etf/etf.schema.json`, cloned read-only during this run):
a `trace` record requires `messages`, which the export writes; `chosen` /
`rejected` accept plain strings, which is the shape step 2 emits; and the
schema sets no `additionalProperties: false`, so the export's extra top-level
`user` / `assistant` copies are ignored, exactly as the export's own comment
says. The shape is confirmed compatible.

### Size, and the one surprise in it

Measured on the exported `train.jsonl`:

| Measure                                                                   | Value                                 |
| ------------------------------------------------------------------------- | ------------------------------------- |
| examples                                                                  | 334                                   |
| total characters (system + user + assistant)                              | 4,738,825                             |
| median characters per example                                             | 14,131                                |
| characters of the **system prompt alone**, per example                    | 13,679 (identical in all 334 records) |
| estimated tokens per epoch (chars / 4, no tokenizer download was allowed) | ~1,184,700                            |
| estimated tokens per example (median)                                     | ~3,530                                |

**96% of every training example is the shared system prompt** (the op-set
description). Consequences, all of which are estimates until a real tokenizer
measures them:

- `max_seq_len` will be **4096**, not the 512–2048 the guidance mentions for
  short chats: brewery sizes it to the smallest power of two that fits ~90% of
  the examples (`docs/models.md`, "max_seq_len is sized from your data"), and
  the median example is ~3.5k tokens.
- Sequence length drives memory (the logits term alone is ~9.5 GB at 4096
  tokens with this vocabulary) and therefore the GPU choice.

Shortening the system prompt (or putting it in one place) would cut the
training cost by roughly an order of magnitude, but that changes the drafting
prompt and is **out of scope for this plan** (it would touch
`scripts/card-scripts/draft-lib.ts` and the prompt used by the live pipeline).

---

## 2. Recommended pilot configuration

**Pilot: `Qwen/Qwen3.5-2B` (instruct), LoRA, SFT, 2 epochs.** Rationale below.

| Setting              | Value                                                                | Source                                                  |
| -------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- |
| Base model           | `Qwen/Qwen3.5-2B` (1.88 B params, 262144 ctx, Apache-2.0)            | brewery-ai `docs/models.md`, "Qwen3.5" table            |
| Objective / method   | `sft` / `lora`                                                       | brewery-ai `docs/models.md`, "Qwen3.5" guidelines       |
| Learning rate        | 0.0002 (recommended band 5e-05–0.0003)                               | same table                                              |
| LoRA rank            | 16 (recommended band 8–64)                                           | same table                                              |
| Epochs               | 2 (recommended band 1–3)                                             | same table                                              |
| Effective batch      | 8 (recommended band 8–64)                                            | same table; see the step-count note below               |
| `max_seq_len`        | 4096 (auto from the data)                                            | `docs/models.md`, "max_seq_len is sized from your data" |
| LoRA targets         | brewery's `default` preset (includes the Gated DeltaNet projections) | `src/brewery_ai/models/profiles/qwen3_5.yaml`           |
| Optimiser / schedule | `adamw_torch_fused` (default), cosine                                | `src/brewery_ai/models/profiles/defaults.yaml`          |

### Why Qwen3.5 2B and not 4B for the pilot

- 2B is the configuration brewery-ai actually shipped a LoRA SFT demo on
  (`README.md`, "Brewed with Brewery": Homebrew-Qwen3.5-2B-Grandmas-Kitchen,
  LoRA SFT, 826 examples, ~2 epochs, one rented GPU). It is the only sizing
  precedent available, and the brief names it as such.
- At `max_seq_len` 4096, brewery's own memory estimator puts 2B LoRA at
  **16.6 GB** and 4B LoRA at **22.2 GB**. 22.2 GB does not fit a 24 GB card
  under brewery's 92% headroom rule (`src/brewery_ai/hardware/estimate.py`),
  so 4B would force a 32 GB / 48 GB card and roughly double the money.
- 4B is the better model on paper (`Qwen/Qwen3.5-4B` is marked _recommended_
  in brewery's model table) and is the natural follow-up if the 2B pilot shows
  the model cannot express the op set. **Recommendation: run 2B as the pilot,
  and only consider 4B if the pilot's numbers justify it.**

### Step count, and how our 334 examples compare with the demo

With 334 examples and an effective batch of 8, one epoch is ~42 optimizer
steps and 2 epochs is ~84 steps. With brewery's default effective batch of 16
it would be ~42 steps for 2 epochs, which is few enough that the adapter may
barely move; effective batch 8 stays inside the recommended band (8–64) and
doubles the number of updates. **This is a judgement, not a measured result.**

The grandma-recipe demo used **826** examples at ~2 epochs; our pilot uses
**334**, i.e. ~40% of the demo's data. Same epoch count is therefore
reasonable — the demo shows ~2 epochs is enough for a small LoRA on a few
hundred short examples — but the demo does **not** tell us anything about our
domain, our prompt length (ours is 16x longer per example) or our task. The
demo is a precedent for the _shape_ of the run, not for its outcome.

---

## 3. GPU-hour and cost estimate (ESTIMATES)

### Method

- **Time**: brewery-ai's own estimator, `estimate_hours()` in
  `src/brewery_ai/hardware/estimate.py` (clone `empero-org/brewery-ai`,
  `--depth 1`, read during this run on **2026-10-31**), run against the
  Qwen3.5-2B profile (`src/brewery_ai/models/profiles/qwen3_5.yaml`) with
  `TrainShape(method="lora", objective="sft", seq_len=4096, micro_batch=1,
lora_rank=16)`, `total_tokens = 1,184,706 × 2 epochs`.
- **Price**: brewery-ai's GPU catalog, `src/brewery_ai/hardware/gpus.py`, which
  states its prices are "on-demand $/hour for one GPU, checked on 2026-10-04
  (Runpod pricing page; Vast.ai live offers API)" (`PRICES_CHECKED =
"2026-10-04"`). Access date for this plan: **2026-10-31**.
- **Token count** is an estimate: characters / 4. No tokenizer was downloaded
  (model downloads are out of scope for this task), so the real token count
  could be 10–25% off in either direction.
- **Training hours only.** Setup (model download, environment install, data
  upload) and the evaluation bake-off are **not** included in the training
  numbers; they are listed separately below.

### Rented-GPU options (ESTIMATE)

Prices are Runpod / Vast.ai on-demand $/hour per GPU, as published in
brewery-ai's catalog (`gpus.py`, checked 2026-10-04). Runpod's published
pricing page is <https://www.runpod.io/pricing> and Vast.ai's live-offer API is
behind <https://vast.ai>; both were read via brewery-ai's catalog on
2026-10-31, not directly, because this task allows only brewery-ai doc reads
on the network. **Confirm the live price on the provider's page on the day of
the run — these are estimates, not quotes.**

| GPU          | VRAM  | Fits 2B LoRA @4096? | Training hours (EST.) | Price $/h (Runpod / Vast.ai) | Training cost (EST.) |
| ------------ | ----- | ------------------- | --------------------- | ---------------------------- | -------------------- |
| RTX 3090     | 24 GB | yes (16.6 GB)       | 0.21 – 0.44           | 0.22 / 0.11–0.18             | $0.02 – $0.10        |
| RTX 4090     | 24 GB | yes                 | 0.09 – 0.19           | 0.34 / 0.27–0.42             | $0.02 – $0.08        |
| RTX 5090     | 32 GB | yes                 | 0.07 – 0.15           | 0.69 / 0.28–0.54             | $0.02 – $0.10        |
| RTX A6000    | 48 GB | yes                 | 0.11 – 0.23           | 0.33 / 0.36–0.40             | $0.04 – $0.09        |
| RTX 6000 Ada | 48 GB | yes                 | 0.05 – 0.10           | 0.74 / 0.52–0.76             | $0.03 – $0.08        |

For reference, the same estimator on **Qwen3.5-4B** LoRA at 4096 (22.2 GB, does
not fit a 24 GB card): RTX A6000 0.24–0.52 h ≈ $0.08–$0.21; RTX 5090
0.16–0.33 h ≈ $0.04–$0.23.

**Bottom line (ESTIMATE): the training itself costs well under $0.25 on any of
these cards.** The realistic bill is dominated by everything around it:

| Line item                                             | ESTIMATE         | Notes                                                                                                                 |
| ----------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| Training (2B LoRA, 2 epochs)                          | $0.02 – $0.10    | from the table above                                                                                                  |
| Setup + data upload + model download on the pod       | $0.06 – $0.26    | ~0.25–0.75 h of pod time at $0.22–$0.34/h; a 4 GB model download dominates the low end                                |
| Serving the fine-tuned model for the 50-card bake-off | $0.02 – $0.10    | same pod, 50 cards × ~3.5k prompt tokens                                                                              |
| Disk / storage until the pod is destroyed             | unknown          | provider-specific; brewery's rental guide warns that stopped pods still bill storage                                  |
| **DPO step (step 2 data → preference tuning)**        | **not included** | needs a real draft log first: no rejected draft is stored in this repo yet (`scripts/card-scripts/preference-lib.ts`) |
| **Wider bake-off / second bake-off arm set**          | **not included** | out of scope for the pilot                                                                                            |
| **Anything past the pilot (full run, 4B, sweeps)**    | **not included** | each is a new approval                                                                                                |

**Total pilot estimate: roughly $0.10 – $0.50 of rented GPU time, plus $10 of
provider credit to open the account (brewery's rental guide suggests $10 is
plenty for a first small brew).** The number that matters for the decision is
the order of magnitude: this is a few cents of training, and the decision is
about Alex's time and the eval harness, not about money.

### Local-GPU alternative

Running the same pilot on Alex's desktop GPU costs $0 in provider fees, and
the money is irrelevant next to these two constraints:

1. **Hardware requirement (ESTIMATE, from brewery's estimator):** an NVIDIA
   GPU with **≥ 24 GB VRAM** for the 2B LoRA at `max_seq_len` 4096 (16.6 GB
   estimated peak, bf16). A 32 GB card (RTX 5090 class) is comfortable; a
   16 GB card is not enough at this sequence length.
2. **Software requirement:** brewery's Qwen3.5 notes require CUDA PyTorch and
   `flash-linear-attention` (without it the linear-attention layers fall back
   to a much slower PyTorch path). brewery's README also notes that QLoRA and
   image LoRAs are only tested on NVIDIA GPUs; on AMD, LoRA and full
   fine-tuning are the safe choice.

**Alex must confirm his desktop GPU (model, VRAM, and CUDA or ROCm version)
meets this requirement before the local path is chosen. This plan does not
assert what his machine has — that is unknown from the repo.**

---

## 4. Evaluation plan (a fourth #2514-format bake-off arm)

The fine-tuned model is scored as a **fourth arm in the #2514 bake-off**
(`scripts/card-script-bakeoff.ts` + `scripts/card-scripts/bakeoff-lib.ts`),
against the same fixed 50-card list: 20 gold cards scored against the
hand-written scripts, 30 new cards scored against the expected draft or
`needs_new_op`.

The report is the existing `#2514` table format, with the fine-tuned model as
one more row (`renderBakeoffReport` in `scripts/card-scripts/bakeoff-lib.ts`):

```
| Arm | Gold exact | New correct | False drafts | Invalid | Errors | Tokens in / out | Cost | Per 1,000 cards | Time |
```

Fields to read off the new row: **gold exact** (strict match, wording fields
ignored), **new correct**, **false drafts**, **invalid**, and **cost per
1,000 cards**. For a self-hosted model the API cost is $0; the row then reports
tokens in/out and wall-clock time, and "per 1,000 cards" is the local compute
cost, not an API bill.

Prerequisites that are **not** in this change (they are code work, done only
after approval):

- The bake-off harness currently accepts only the `gemini-batch`, `zai` and
  `openrouter` arm providers (`parseArms` in `scripts/card-scripts/bakeoff-lib.ts`).
  A local OpenAI-compatible arm (vLLM or Ollama serving the LoRA adapter) has
  to be added before the fine-tuned model can be a row in that table.
- The fine-tuned adapter has to be served over an OpenAI-compatible endpoint
  (the same shape the drafting pipeline already accepts through
  `OPENAI_BASE_URL` in `scripts/draft-card-scripts.ts`).

**Leakage control:** the 20 gold cards are the held-out eval split and are
never in `train.jsonl`; the export fails loudly if one leaks. The 6 few-shot
examples the bake-off uses are not gold cards. The new (non-gold) 30 cards
were never in the training set either. No card in the bake-off is a training
example.

---

## 5. SFT → DPO go/no-go

Run DPO (step 2's `preferences.jsonl`) **only if the SFT pilot still produces
false drafts** — a script for a card whose abilities the op set cannot
express, so the card would play wrong. That is the failure mode DPO exists to
fix, and it is the one the bake-off counts separately.

Additional go/no-go conditions:

- **`needs_new_op` cards must prefer an explicit refusal over a forced
  script.** If the SFT model drafts a script for a card that the op set cannot
  express (a "false draft"), that is a **no-go for shipping the model**, not
  a reason to run DPO automatically: it is the signal that the DPO pairs
  (`chosen` = refusal, `rejected` = the forced script) are needed and
  correctly labelled.
- The SFT pilot is a **no-go** if the new arm's false-draft count is higher
  than the current best arm's, or if its invalid count is not lower.
- The SFT pilot is a **go** if it matches or beats the current best arm on
  gold exact and new correct with no false drafts, and if the 2B model is
  still the cost/benefit winner against the 4B alternative.
- If the model is good enough, DPO is **not** needed. Preference tuning on a
  handful of pairs can easily make a small model worse.

---

## 6. Risks

| Risk                             | Note                                                                                                                                                                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| False drafts                     | The dangerous failure. A wrong script plays the card wrong. Tracked separately in the bake-off; blocks shipping.                                                                                                                                                  |
| `needs_new_op` refusal behaviour | The training set contains scripts only; explicit refusals are not in the SFT data (the refusal format comes from the step-2 preference pairs). The model may learn to always draft. The bake-off's "false drafts" count on the `needs_new_op` cards is the check. |
| Eval leakage                     | The 20 gold cards are held out of training and the export enforces it. Re-run the export before every run and keep the artifact out of git.                                                                                                                       |
| Prompt length                    | The 13,679-character system prompt in every example drives `max_seq_len` to 4096, which drives memory and cost. Not fixable without a code change.                                                                                                                |
| Few steps                        | ~84 optimizer steps at effective batch 8 is few. If the pilot shows no behaviour change, the fix is more epochs / a larger effective batch (still inside the recommended bands), not a bigger model.                                                              |
| Token count is estimated         | chars/4, not a tokenizer. Real hours may be 10–25% off; the cost is cents either way.                                                                                                                                                                             |
| Prices move                      | The catalog prices were checked 2026-10-04; check the provider's live price on the day.                                                                                                                                                                           |
| Rented GPU hygiene               | Stopped pods still bill storage; terminate the pod when the run is done.                                                                                                                                                                                          |

---

## 7. The Alex gate

**The decision being asked:** approve a **short SFT pilot** (the 2B LoRA SFT
run on 334 examples, plus the 50-card bake-off), and nothing beyond it.

Options:

- **A — approve the pilot.** Alex says go; the pilot runs on a rented GPU
  (estimated well under $0.50 of GPU time) or on his own GPU if he confirms
  it meets the requirement above. Nothing else is started. The pilot ends with
  a #2514-format report and a go/no-go against section 5.
- **B — approve a full run instead of a pilot.** Only sensible with a stated
  reason (for example: the pilot's numbers are already known, or the model
  choice should be 4B). A full run means a larger dataset and/or more
  epochs, and its estimate is **not** in this document — it would be produced
  from the pilot's measured step time, not guessed.
- **C — reject.** Nothing runs; the export stays a local artifact and the
  existing Gemini bake-off arm remains the drafting path.

**What happens after approval (A):**

1. Re-run the export into a local (gitignored) directory and validate it:
   `npx tsx scripts/export-card-script-dataset.ts --out dataset-out`, then
   `brewery etf validate dataset-out/train.jsonl`.
2. Add the local OpenAI-compatible arm to the bake-off harness (a small code
   change; separate PR).
3. Rent a GPU per brewery's guide, run the SFT job with the section 8
   hyperparameters, download the adapter, serve it, run the bake-off, produce
   the report.
4. Report back: the #2514-format table with the fine-tuned row, and the
   section 5 go/no-go decision. **No DPO run and no second run without a
   further approval from Alex.**

---

## 8. Commands that would run the pilot (NOT executed here)

Nothing below was run. They are quoted from brewery-ai's public docs
(`README.md`, `docs/models.md`, `src/brewery_ai/remote/guides.py`) and from
this repo's own scripts.

Data (this repo, local, no cost):

```sh
npx tsx scripts/export-card-script-dataset.ts --out dataset-out
```

Brewery install and setup (brewery-ai `README.md`, "Quick start" and
"Training on your own GPU"):

```sh
pip install "brewery-ai @ git+https://github.com/empero-org/brewery-ai"
# on the training machine (NVIDIA):
pip install "brewery-ai[train] @ git+https://github.com/empero-org/brewery-ai"
brewery                 # guided session
brewery new planar-nexus-card-scripts
brewery setup           # pick the guiding model
brewery hardware        # what Brewery found on this machine
brewery etf validate dataset-out/train.jsonl
```

Rental (brewery-ai `src/brewery_ai/remote/guides.py`; the agent asks for the
GPU and the SSH command interactively):

```sh
brewery hardware --ssh "ssh root@<host> -p <port> -i ~/.ssh/id_ed25519"
```

Training itself is launched by the guided session (brewery's "How a brew
works": Recipe → Brewing), with the section 2 hyperparameters; there is no
hand-written `accelerate launch` line to copy from the public docs, so the
hyperparameters above are the contract, not a literal command.

Evaluation (this repo, after the local arm exists):

```sh
npx tsx scripts/card-script-bakeoff.ts \
  --arms "gemini-batch:gemini-3.1-flash-lite,zai:glm-5.3-flash,openrouter:openrouter/free,local:<served-model>" \
  --out bakeoff-out
```

---

## 9. Sources

| Claim                                                                                                              | Source                                                                                                 | Accessed                |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ----------------------- |
| Supported models (Qwen3 / Qwen3.5 / Llama 3.x / Gemma 3 / Gemma 4), LoRA / QLoRA / full, CPT → SFT → DPO regimes   | brewery-ai `README.md`; `docs/models.md`                                                               | 2026-10-31              |
| Qwen3.5-2B / 4B hyperparameter guidelines (lr 0.0002, rank 16, 2 epochs, effective batch 8–64, `max_seq_len` auto) | brewery-ai `docs/models.md`, section "Qwen3.5"                                                         | 2026-10-31              |
| `max_seq_len` is sized from the data (~90% of examples, min 512)                                                   | brewery-ai `docs/models.md`, preamble                                                                  | 2026-10-31              |
| ETF v1: `trace` records need `messages`; `chosen`/`rejected` accept strings; unknown fields are ignored            | brewery-ai `docs/etf.md`; `src/brewery_ai/etf/etf.schema.json`                                         | 2026-10-31              |
| Memory and wall-clock estimator used for the hours/costs                                                           | brewery-ai `src/brewery_ai/hardware/estimate.py` (`estimate_memory`, `estimate_hours`, `fitting_gpus`) | 2026-10-31              |
| GPU VRAM and on-demand $/hour (Runpod / Vast.ai), "checked on 2026-10-04"                                          | brewery-ai `src/brewery_ai/hardware/gpus.py` (`PRICES_CHECKED`)                                        | 2026-10-31              |
| Rental procedure and billing warnings                                                                              | brewery-ai `src/brewery_ai/remote/guides.py`                                                           | 2026-10-31              |
| 826-example, ~2-epoch, one-rented-GPU LoRA SFT precedent                                                           | brewery-ai `README.md`, "Brewed with Brewery"                                                          | 2026-10-31              |
| Model profile (dims, LoRA targets) used for the estimate                                                           | brewery-ai `src/brewery_ai/models/profiles/qwen3_5.yaml`; `defaults.yaml`                              | 2026-10-31              |
| Provider pricing pages to re-check on the day of the run                                                           | <https://www.runpod.io/pricing>, <https://vast.ai>                                                     | not fetched in this run |

Repository sources for this repo's own facts: `scripts/card-scripts/dataset-lib.ts`,
`scripts/card-scripts/preference-lib.ts`, `scripts/export-card-script-dataset.ts`,
`scripts/card-scripts/bakeoff-lib.ts`, `scripts/data/bakeoff-cards.json`,
`docs/card-scripts.md`.
