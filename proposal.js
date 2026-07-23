/**
 * ============================================================
 * proposal.js — Layer 4: Proposal Draft Bridge
 * AI-Powered Grant Discovery System
 * Version: 1.0 | July 2026
 *
 * WHAT THIS FILE DOES:
 * Bridges the AI discovery pipeline to the proposal drafting
 * step using Google NotebookLM as the knowledge base.
 *
 * WHY NOTEBOOKLM (not another API call):
 *   - Free, no API key needed
 *   - Grounded in ERE's REAL documents (not hallucinated)
 *   - Staff uploads actual org docs once — reused forever
 *   - Human reviews every draft before submitting
 *   - NotebookLM explicitly warns when data is missing
 *
 * WHAT THIS FILE PROVIDES:
 *   1. Step-by-step NotebookLM instructions in the UI
 *   2. Document checklist (what to upload to NotebookLM)
 *   3. RFP prompt builder — generates the exact prompt
 *      staff pastes into NotebookLM for each opportunity
 *   4. Placeholder tracker — lists what staff must fill in
 *   5. Proposal status tracker — links proposals to tracker rows
 *
 * HUMAN-IN-THE-LOOP RULES (enforced by UI instructions):
 *   - Use ONLY information from uploaded org documents
 *   - Never invent statistics, budgets, or testimonials
 *   - Missing information → clearly marked [INSERT: ...] placeholder
 *   - Staff reviews, edits, and approves every draft
 *   - Staff submits — AI never submits automatically
 *
 * DEPENDENCIES:
 *   config.js (CONFIG, esc, showToast, today, loadProfile)
 *   tracker.js (trackerRows — to show pursuing opportunities)
 * ============================================================
 */


// ============================================================
// NOTEBOOKLM DOCUMENT CHECKLIST
// The 8 core documents ERE should upload once.
// Displayed in the UI as a checklist for the founder.
// ============================================================

const NOTEBOOKLM_DOCS = [
  {
    id:       "mission",
    label:    "Mission, vision, and values statement",
    purpose:  "Core context for every proposal — NotebookLM answers 'who are we'",
    required: true,
    tip:      "Even a one-page doc works. Include founding story if available.",
  },
  {
    id:       "programs",
    label:    "Program descriptions (tutoring, test prep, soft skills)",
    purpose:  "NotebookLM uses this to answer 'what do we do' in grant language",
    required: true,
    tip:      "Include participant numbers, session frequency, and outcomes.",
  },
  {
    id:       "impact",
    label:    "Student outcome data and impact statistics",
    purpose:  "Critical for grant proposals — AI pulls real numbers, not invented ones",
    required: true,
    tip:      "GPA improvements, test score gains, graduation rates — whatever you have.",
  },
  {
    id:       "501c3",
    label:    "IRS 501(c)(3) determination letter",
    purpose:  "Proves eligibility — referenced in nearly every application",
    required: true,
    tip:      "Scan and upload as PDF. Every funder asks for this.",
  },
  {
    id:       "funders",
    label:    "Past funders list (with amounts and years)",
    purpose:  "Shows funding history — builds credibility with new funders",
    required: true,
    tip:      "A simple spreadsheet or even a list in a doc works fine.",
  },
  {
    id:       "budget",
    label:    "Annual budget overview (high level)",
    purpose:  "Many funders require org budget range for eligibility screening",
    required: false,
    tip:      "Total revenue and expenses by category — no need for full audit.",
  },
  {
    id:       "testimonials",
    label:    "Student testimonials and parent quotes",
    purpose:  "NotebookLM weaves these into proposals for authentic impact stories",
    required: false,
    tip:      "Even 3-4 short quotes make proposals significantly stronger.",
  },
  {
    id:       "geography",
    label:    "Geographic service areas (cities, zip codes, schools served)",
    purpose:  "Filters opportunities to Illinois and Texas funders accurately",
    required: false,
    tip:      "List specific neighborhoods, schools, or zip codes if possible.",
  },
];


// ============================================================
// PROPOSAL PROMPT BUILDER
// Generates the exact prompt staff pastes into NotebookLM
// for each specific grant opportunity.
// ============================================================

/**
 * Build the NotebookLM prompt for a specific opportunity.
 * Staff copies this and pastes it into their NotebookLM notebook
 * alongside the funder's RFP.
 *
 * @param {Object} opp  opportunity object from tracker or pipeline
 * @returns {string}    ready-to-paste NotebookLM prompt
 */
function buildNotebookLMPrompt(opp) {
  return `You are helping draft a grant proposal for ${opp.funder || "[FUNDER NAME]"}.

GRANT PROGRAM: ${opp.program || "[PROGRAM NAME]"}
FUNDING AMOUNT: ${opp.amount || "[AMOUNT]"}
DEADLINE: ${opp.deadline || "[DEADLINE]"}
APPLICATION URL: ${opp.url || "[URL]"}

TASK:
Using ONLY the organization documents I have uploaded to this notebook,
draft a grant proposal that addresses the funder's priorities.

STRICT RULES:
1. Use ONLY facts, statistics, and quotes from the uploaded documents
2. If a piece of information is missing, write [INSERT: description of what's needed]
   instead of inventing it
3. Never fabricate statistics, outcomes, partner names, or budgets
4. Write in a professional, grant-appropriate tone
5. Keep each section concise — program officers read hundreds of proposals

PROPOSAL SECTIONS TO DRAFT:
1. Organization Overview (2-3 sentences: who we are, mission, history)
2. Statement of Need (3-4 sentences: the problem we address, with data)
3. Proposed Program (4-5 sentences: what we will do with this funding)
4. Expected Outcomes (3-4 sentences: measurable results, with real numbers)
5. Organizational Capacity (2-3 sentences: why we can deliver this)
6. Budget Narrative (brief: how the grant amount will be used)

After the draft, list ALL placeholders you used so staff can fill them in.

FUNDER CONTEXT (from grant tracker):
Mission alignment: ${opp.missionAlignment || "[Check funder guidelines]"}
Why we qualify: ${opp.whyQualifies || "[Review eligibility requirements]"}
Risks/flags: ${opp.risks || "None noted"}
Confidence: ${opp.confidence || "Medium"}`;
}

/**
 * Build a generic proposal prompt when no specific opportunity
 * is selected. Used for practice or template creation.
 * @param {Object} profile  org profile
 * @returns {string}
 */
function buildGenericPrompt(profile) {
  return `You are helping draft a grant proposal for a general foundation funder.

Using ONLY the organization documents uploaded to this notebook,
draft a flexible grant narrative that can be adapted for multiple funders.

ORGANIZATION: ${profile.name || "Educate. Radiate. Elevate."}
MISSION: ${profile.mission || ""}
LOCATIONS: ${profile.locations || "Illinois and Texas"}
GRANT RANGE: ${profile.grantRange || "$5,000 – $100,000"}

STRICT RULES:
1. Use ONLY facts from uploaded documents — no invented statistics
2. Mark missing information as [INSERT: what's needed]
3. Write in professional, grant-appropriate language
4. Keep sections concise and evidence-based

SECTIONS TO DRAFT:
1. Organization Overview
2. Statement of Need (with real data from documents)
3. Program Description
4. Expected Outcomes (with measurable targets from documents)
5. Organizational Capacity
6. Closing Statement

List ALL placeholders at the end.`;
}


// ============================================================
// RENDER PROPOSAL TAB
// Main render function called when Proposal tab is opened.
// ============================================================

/**
 * Render the full proposal tab UI.
 * Called by index.html when the Proposal tab is activated.
 */
async function renderProposalTab() {
  const el = document.getElementById("proposal-content");
  if (!el) return;

  const profile = await loadProfile();

  // Get pursuing opportunities from tracker for quick access
  const pursuing = trackerRows
    .filter((r) => normaliseLegacyStatus(r.status) === "Pursue" || r.status === "New")
    .sort((a, b) => {
      const da = new Date(a.deadline || "2999-01-01");
      const db = new Date(b.deadline || "2999-01-01");
      return da - db;
    })
    .slice(0, 10);

  el.innerHTML = `

    <!-- Step 1: NotebookLM Setup -->
    <div class="panel" style="margin-bottom:var(--gap-md);">
      <h2>Step 1 — Set up your NotebookLM knowledge base</h2>
      <p class="panel-desc">
        Do this once. Upload your organization documents to NotebookLM.
        Every proposal draft will draw from these — no invented facts.
      </p>

      <div class="flex-between" style="margin-bottom:var(--gap-md);">
        <a href="${esc(CONFIG.proposal.notebookLMUrl)}"
           target="_blank"
           rel="noopener"
           class="btn btn-primary">
          Open Google NotebookLM →
        </a>
        <span class="muted" style="font-size:var(--text-sm);">
          Free · No API key · notebooklm.google.com
        </span>
      </div>

      <ul class="doc-checklist">
        ${NOTEBOOKLM_DOCS.map((doc) => `
          <li>
            <span class="check-icon">${doc.required ? "★" : "○"}</span>
            <div>
              <div style="font-weight:600;font-size:var(--text-sm);">
                ${esc(doc.label)}
                ${doc.required
                  ? `<span class="pill pill-open" style="margin-left:6px;font-size:9px;">Required</span>`
                  : `<span style="color:var(--muted);font-size:11px;margin-left:6px;">Optional</span>`}
              </div>
              <div style="color:var(--muted);font-size:var(--text-xs);margin-top:2px;">
                ${esc(doc.purpose)}
              </div>
              <div style="color:var(--purple-soft);font-size:var(--text-xs);margin-top:1px;">
                💡 ${esc(doc.tip)}
              </div>
            </div>
          </li>`).join("")}
      </ul>

      <div class="api-note" style="margin-top:var(--gap-md);">
        <b>One-time setup:</b> Create a notebook at notebooklm.google.com,
        upload these documents, and keep the notebook open whenever you
        draft proposals. You don't need to re-upload — NotebookLM remembers.
      </div>
    </div>

    <!-- Step 2: Generate Prompt -->
    <div class="panel" style="margin-bottom:var(--gap-md);">
      <h2>Step 2 — Generate your proposal prompt</h2>
      <p class="panel-desc">
        Select an opportunity from your tracker, generate the prompt,
        then paste it into NotebookLM alongside the funder's RFP.
      </p>

      <!-- Opportunity selector -->
      <div class="field" style="margin-bottom:var(--gap-md);">
        <label class="field-label">Select opportunity from tracker</label>
        <select id="proposal-opp-select" onchange="onProposalOppChange()">
          <option value="">— Select an opportunity —</option>
          <option value="generic">📝 Generic template (no specific funder)</option>
          ${pursuing.length > 0
            ? `<optgroup label="Pursuing / New">
                 ${pursuing.map((r) => `
                   <option value="${esc(r.id)}">
                     ${esc(r.funder)}${r.program ? ` — ${r.program}` : ""}
                     ${r.deadline ? ` (due ${r.deadline})` : ""}
                   </option>`).join("")}
               </optgroup>`
            : ""}
        </select>
      </div>

      <!-- Generated prompt display -->
      <div id="proposal-prompt-wrap" style="display:none;">
        <div class="field-label" style="margin-bottom:var(--gap-sm);">
          Prompt to paste into NotebookLM
        </div>
        <div style="position:relative;">
          <pre id="proposal-prompt-text"
               style="white-space:pre-wrap;font-family:var(--font-body);
                      font-size:var(--text-sm);line-height:1.65;
                      background:var(--paper);border:1px solid var(--line);
                      border-radius:var(--radius-md);padding:var(--gap-md);
                      max-height:400px;overflow-y:auto;margin:0;">
          </pre>
        </div>
        <div class="btn-row">
          <button class="btn btn-primary" onclick="copyProposalPrompt()">
            Copy prompt
          </button>
          <a href="${esc(CONFIG.proposal.notebookLMUrl)}"
             target="_blank" rel="noopener"
             class="btn btn-ghost">
            Open NotebookLM →
          </a>
        </div>
      </div>

      ${pursuing.length === 0
        ? `<div class="api-note">
             No opportunities marked "Pursue" or "New" in your tracker yet.
             Run a discovery search and add opportunities to the tracker first.
           </div>`
        : ""}
    </div>

    <!-- Step 3: How to use NotebookLM -->
    <div class="panel" style="margin-bottom:var(--gap-md);">
      <h2>Step 3 — Draft and review in NotebookLM</h2>
      <p class="panel-desc">
        Follow these steps inside NotebookLM after pasting the prompt.
      </p>

      <div style="counter-reset:steps;">
        ${[
          {
            title: "Paste the funder's RFP or guidelines",
            detail: "Copy the grant guidelines or application questions from the funder's website. Paste them into NotebookLM as a new source document before asking it to draft.",
            tip: "If the funder has a PDF application, upload it directly.",
          },
          {
            title: "Paste the generated prompt",
            detail: "Copy the prompt from Step 2 above and paste it into the NotebookLM chat. It will draft a proposal using only your uploaded documents.",
            tip: "Ask follow-up questions like 'strengthen the Statement of Need' or 'add more specific outcome data'.",
          },
          {
            title: "Fill in every [INSERT: ...] placeholder",
            detail: "NotebookLM marks every gap with a placeholder. Do not skip these — a proposal with placeholders submitted to a funder will be rejected.",
            tip: "Keep a list of common placeholders so you have the data ready for future proposals.",
          },
          {
            title: "Human review and edit",
            detail: "Read the full draft as a program officer would. Check every statistic against your actual documents. Edit for your organization's voice.",
            tip: "Read it aloud — awkward sentences jump out immediately.",
          },
          {
            title: "Get internal approval before submitting",
            detail: "The ERE founder or designated approver reviews the final draft. No application is submitted without human sign-off.",
            tip: "Build a simple checklist: stats verified ✓, mission accurate ✓, budget correct ✓, deadline met ✓.",
          },
        ].map((step, i) => `
          <div style="display:flex;gap:var(--gap-md);padding:var(--gap-md) 0;
                      border-bottom:1px solid var(--line-soft);">
            <div style="width:32px;height:32px;border-radius:50%;
                        background:var(--purple);color:#fff;
                        display:flex;align-items:center;justify-content:center;
                        font-family:var(--font-display);font-weight:700;
                        font-size:var(--text-md);flex-shrink:0;">
              ${i + 1}
            </div>
            <div>
              <div style="font-weight:600;font-size:var(--text-md);
                          margin-bottom:4px;">${esc(step.title)}</div>
              <div style="font-size:var(--text-sm);color:var(--ink);
                          line-height:1.6;margin-bottom:4px;">
                ${esc(step.detail)}
              </div>
              <div style="font-size:var(--text-xs);color:var(--purple-soft);">
                💡 ${esc(step.tip)}
              </div>
            </div>
          </div>`).join("")}
      </div>
    </div>

    <!-- Step 4: Placeholder tracker -->
    <div class="panel">
      <h2>Common placeholders to prepare</h2>
      <p class="panel-desc">
        Have these ready before drafting. NotebookLM will insert
        [INSERT: ...] markers wherever your documents don't have the data.
      </p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--gap-sm);">
        ${[
          ["Number of students served annually", "e.g. 247 students in 2025-26"],
          ["Average GPA improvement", "e.g. 0.8 GPA points over 12 weeks"],
          ["Test score improvement", "e.g. 18% average ACT score increase"],
          ["Program cost per student", "e.g. $1,240 per student per year"],
          ["Staff / volunteer count", "e.g. 3 full-time, 12 volunteers"],
          ["Years in operation", "e.g. Founded 2019, 6 years of service"],
          ["Geographic reach", "e.g. 14 schools across Chicago South Side"],
          ["Partner organizations", "e.g. Chicago Public Schools, YMCA"],
        ].map(([placeholder, example]) => `
          <div style="background:var(--paper);border:1px solid var(--line);
                      border-radius:var(--radius-sm);padding:10px 12px;">
            <div style="font-size:var(--text-xs);font-weight:700;
                        color:var(--purple-deep);margin-bottom:2px;">
              [INSERT: ${esc(placeholder)}]
            </div>
            <div style="font-size:var(--text-xs);color:var(--muted);">
              ${esc(example)}
            </div>
          </div>`).join("")}
      </div>
    </div>`;
}


// ============================================================
// OPPORTUNITY SELECTOR HANDLER
// Called when staff selects an opportunity from the dropdown.
// ============================================================

/**
 * Handle opportunity selection in the proposal tab dropdown.
 * Generates and displays the NotebookLM prompt.
 */
async function onProposalOppChange() {
  const select = document.getElementById("proposal-opp-select");
  const wrap   = document.getElementById("proposal-prompt-wrap");
  const text   = document.getElementById("proposal-prompt-text");

  if (!select || !wrap || !text) return;

  const selectedId = select.value;

  if (!selectedId) {
    wrap.style.display = "none";
    return;
  }

  let prompt = "";

  if (selectedId === "generic") {
    // Generic template
    const profile = await loadProfile();
    prompt = buildGenericPrompt(profile);
  } else {
    // Find opportunity in tracker rows
    const row = trackerRows.find((r) => r.id === selectedId);
    if (row) {
      prompt = buildNotebookLMPrompt(row);
    } else {
      // Try pipeline results
      const opp = findOpportunityById(selectedId);
      if (opp) {
        prompt = buildNotebookLMPrompt(opp);
      } else {
        showToast("Opportunity not found. It may have been removed.");
        wrap.style.display = "none";
        return;
      }
    }
  }

  // Display the generated prompt
  text.textContent   = prompt;
  wrap.style.display = "block";

  // Scroll to the prompt
  wrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/**
 * Copy the generated NotebookLM prompt to clipboard.
 */
function copyProposalPrompt() {
  const text = document.getElementById("proposal-prompt-text");
  if (!text || !text.textContent.trim()) {
    showToast("No prompt to copy. Select an opportunity first.");
    return;
  }

  navigator.clipboard
    .writeText(text.textContent.trim())
    .then(() => {
      showToast("Prompt copied. Paste it into NotebookLM.");
    })
    .catch(() => {
      // Fallback for browsers without clipboard API
      const range = document.createRange();
      range.selectNode(text);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
      document.execCommand("copy");
      window.getSelection().removeAllRanges();
      showToast("Prompt copied. Paste it into NotebookLM.");
    });
}
