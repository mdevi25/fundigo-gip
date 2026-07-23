# Fundigo — AI-Powered Grant Intelligence for Nonprofits

> **AI Launchpad Hackathon · July 2026**
> Built by Madhu Devi · [github.com/mdevi25/grant-discovery](https://github.com/mdevi25/grant-discovery)

**Find the grants your mission deserves.**

Fundigo is a free, browser-based AI pipeline that helps small nonprofits discover, verify, score, and track open grant opportunities — at zero cost, with humans in control at every step.

---

## The Problem

Small nonprofits often have no dedicated grant staff. Manual grant searching wastes hours. Known funders get exhausted. New opportunities — especially from smaller foundations and corporate programs — are nearly impossible to surface without specialized tools costing hundreds of dollars a month.

Fundigo solves this with one free Groq API key, a Google account, and 30 minutes a week.

---

## Live Site

**[mdevi25.github.io/grant-discovery](https://mdevi25.github.io/grant-discovery/)**

Sign in with Google to use it. Grant data lives in your own org's Google Sheet inside a Shared Drive your organization owns — never on any third-party server.

---

## How It Works — 5-Stage Pipeline

```
Org Profile
    ↓
Discover           compound-beta-mini (live web search, 1 result/run)
    ↓
Verify link        groq/compound + visit_website (real server-side check,
                    dead/unreachable URLs are dropped before qualification)
    ↓
Qualify             gpt-oss-120b — extracts facts only (subject, grade
                    level, geography, nonprofit eligibility). Never
                    decides a tier itself.
    ↓
Match score          Deterministic code, no AI — applies the org's own
                    criteria to those facts, returns HIGH / GOOD / OK / NO
    ↓
Guard               gpt-oss-safeguard-20b (bias + accuracy check, soft-flag only)
    ↓
Tracker             Written directly to the org's Google Sheet
    ↓
Proposal Draft      Google NotebookLM (grounded in real org documents)
    ↓
Human Review        Staff edits, approves, and submits
```

Every result that reaches staff has passed every stage. AI reads and drafts. Deterministic code decides the tier. Humans decide and submit. Always.

---

## Architecture

| Stage | What runs it | What makes the decision |
|---|---|---|
| Discover | `compound-beta-mini` | AI, searches the live web |
| Verify link | `groq/compound` + `visit_website` | AI, real server-side check — dead links are actually dropped, not just flagged |
| Qualify | `gpt-oss-120b` | AI, but only extracts facts — never decides fit |
| Match score | Plain JavaScript | **No AI.** A deterministic function applies the org's own criteria to the facts above |
| Guard | `gpt-oss-safeguard-20b` | AI, soft-flag only, never hard-blocks |
| Tracker | Google Sheets API | Written directly from the browser to the org's own Sheet |
| Proposal | Google NotebookLM | Drafts from uploaded org documents only |
| Human | Staff | Reviews, edits, approves, and submits every application |

The AI-decides-the-tier-directly approach was deliberately abandoned partway through this project after real-world testing showed it could rank things inconsistently. Splitting "read the facts" (AI) from "apply the criteria" (code) makes every match explainable and repeatable — the same facts always produce the same tier.

---

## Features

### Discovery
- Searches funder categories: community foundations, corporate giving, government grants, faith-based, family foundations, healthcare
- Category buttons for one-click runs, or a custom search
- Memory layer automatically excludes already-known funders

### Link Verification
- Every URL checked server-side — dead links, login walls, and unreachable pages are genuinely dropped before they reach qualification
- Dead URLs and verified domains cached to avoid re-checking unnecessarily

### Qualification & Match Scoring
- The AI extracts plain facts about each grant: subject area, grade level served, geography, nonprofit eligibility
- A separate, deterministic function applies the org's actual criteria to those facts and returns one of four tiers: **HIGH / GOOD / OK / NO**
- No AI involvement in the tier decision itself — this is the layer that makes results explainable, not just plausible-sounding
- Anything scoring below the org's threshold is filtered into a **"Not a match"** panel, showing exactly which fact caused the rejection, with an option to add it anyway if a human disagrees

### Guardrails
- `openai/gpt-oss-safeguard-20b` checks language quality, bias, and accuracy
- Soft-flag mode only — AI never hard-blocks. Staff always makes the final call

### Grant Tracker
- Inline editable table — click any cell to update
- Status options: New / Pursue / Submitted / Funded / Declined / Not Eligible / Defer
- Data lives in a Google Sheet inside the org's own Shared Drive — not on any third-party server, and not tied to any one person's personal account
- If a volunteer who's part of the team leaves, removing them from the Shared Drive's membership is all that's needed — the data stays

### Memory System
- Every funder found by discovery is automatically added to memory after each run, building the exclude list for future searches
- Memory stats visible in Settings tab

### Proposal Bridge
- Selects an opportunity from the tracker and generates a tailored NotebookLM prompt
- Instructs NotebookLM to draft from uploaded org documents only — every missing piece marked `[INSERT: ...]`, nothing invented

---

## Zero Cost Architecture

| Tool | Role | Free tier | Credit card? |
|---|---|---|---|
| `compound-beta-mini` | Discovery | Groq free tier | No |
| `groq/compound` | Link verification | Groq free tier | No |
| `openai/gpt-oss-120b` | Fact extraction for qualification | Groq free tier | No |
| `openai/gpt-oss-safeguard-20b` | Guard checks | Same Groq key | No |
| Google NotebookLM | Proposal drafting | Free | No |
| Google Sheets & Drive | Grant data storage, org-owned | Free | No |
| GitHub Pages | Static site hosting | Free | No |
| Google Cloud Functions + Firestore | The one small server-side piece — stores a two-string pointer per org, never actual grant data | Free tier, generous for this scale | Yes, to activate the free tier, no charges expected |

Limits reset automatically. One run uses a small fraction of the daily free allowance.

---

## Getting Started

Setup for a new organization involves a few one-time steps — Google Cloud Console configuration, a Shared Drive for the org's data, and a few environment variables. This isn't a five-minute drag-and-drop deploy anymore, since the architecture prioritizes org data ownership over setup speed.

Full setup instructions are maintained separately, not in this public repo, to keep configuration details out of public view.

---

## License

Proprietary. All rights reserved. See [LICENSE](./LICENSE).

This repository is public for demonstration purposes. Public visibility does not grant permission to use, copy, or reproduce the code.

---

*Built for AI Launchpad Hackathon · July 2026 · by Madhu Devi*

---

## Contact

**Madhu Devi**
- LinkedIn: [linkedin.com/in/madhudevi](https://www.linkedin.com/in/madhudevi/)
- Portfolio: [mdevi25.github.io](https://mdevi25.github.io/)
- GitHub: [github.com/mdevi25](https://github.com/mdevi25)

---

© 2026 Madhu Devi. All rights reserved.
