# µ — Product Document

> A session-driven generative-UI playground for financial research.

**Status:** living document. This is the *why* and the *what*, written before the *how*.
Concrete technical decisions (stack, protocol, package boundaries) are deliberately
left open here and taken up in a separate technical-decisions discussion. Where this
document gestures at architecture, it does so at the level of ideas, not implementation.

---

## 1. What µ is

µ is a small, self-hosted playground where a financial-research **agent** assembles the
**interface** as it reasons. You talk to the agent. It calls tools, looks at data, and
returns a *validated UI spec*. µ renders that spec into a live canvas of typed windows —
a price chart, an implied-vol panel, an options chain, a peer table, a memo, a news
timeline — sitting beside the conversation that produced them. As the conversation moves,
the agent creates, updates, and discards windows. The canvas is an artifact of the
dialogue, not a fixed surface you operate.

You bring your own agent and your own data. µ supplies the runtime that turns structured
agent output into safe, faithful, financial UI — and the contracts that let anyone add a
new window type or a new data source.

µ is **not** a dashboard product, a charting terminal, a data vendor, or a stock picker.
It is generative-UI infrastructure for a single vertical: market research.

### On the name

In the standard model of an asset price, `dS = µS dt + σS dW`, **µ is the drift — the
expected return.** It is the quantity essentially all research is trying, directly or
indirectly, to estimate: *what do I expect to happen, and why.* σ — volatility — is the
other half, and it is exactly what the implied-vol and realized-vol windows render. The
name is a quiet statement of what the tool is for.

It also reads as the SI prefix *micro* (small, minimal — which is the design posture) and
as the Zen 無 (*mu*, "nothing" / "unask the question"). All three readings are intended.
Typed, it is always `mu`; the glyph `µ` is a wordmark.

---

## 2. Why we are building it

### Research is a loop between a question and a view

An analyst's work is a back-and-forth. You ask something; you look at a chart, a table, a
filing; what you see provokes the next question; you look again. The interface is not the
product — it is scaffolding for thought. And the right scaffolding changes with every
question. The view that answers "is this stock trending?" is not the view that answers
"is its vol rich into earnings?" or "how does it rank against its peers on free cash
flow?"

Two families of tools exist today, and each fails this loop in a different way.

- **Dashboards and terminals** — Bloomberg, TradingView, OpenBB. The views are powerful
  but *fixed*: you navigate to pre-built screens. The interface is the constant and your
  question is the variable, so you bend the question to fit the screens. The tool cannot
  compose a view its designers did not anticipate.

- **Chat LLMs.** The reasoning is fluid and responsive, but the output is *prose*. A wall
  of text is a poor way to look at a price series, an options chain, or a vol term
  structure. The model can reason about the data; it cannot *show* it to you in the form
  the data deserves.

### The thesis

Let the thing doing the reasoning compose the interface — per question, and disposably.

The agent already decides what matters. It should also decide *what you see*, expressed as
structured spec and rendered faithfully by a runtime that understands finance. UI becomes
a transient artifact of the analysis: created when a question needs it, updated as the
thinking sharpens, discarded when the conversation moves on.

This is an inversion. Not *a dashboard you query*, but *a conversation that grows a
dashboard*. The canvas is downstream of the dialogue.

### Why now

Three things have converged:

1. **Agents that reliably call tools and emit structured output.** The orchestration that
   used to be the hard part is now a solved-enough commodity.
2. **A real, if young, vocabulary for generative UI** — patterns for an agent to emit a UI
   spec that a host renders safely, rather than free-form code.
3. **Rendering primitives good enough to make practitioner-grade financial views cheap** —
   the chart, table, and timeline components a serious analyst will actually trust.

The piece still missing, *for finance specifically*, is a trusted renderer set and a safe
spec contract between an agent and those renderers. That gap is what µ fills.

### Why a playground, not a platform

This is a deliberate, honest choice of posture.

The hosted, enterprise, data-marketplace version of this idea already exists and is
well-resourced. µ does not try to compete with it. µ occupies the opposite corner: small,
self-hosted, single-user, hackable, *owned*. It is the version you run on your own
machine, point at your own agent and your own data, and modify because the code is yours.

The claim is modest on purpose, and the modesty is the point. µ is a workbench, not a
business. Calling it a "platform" would oversell it; we call it a playground.

---

## 3. The principle

> **The agent decides what to see. The runtime decides how to safely render it. The user
> stays in the conversation.**

This is a separation of powers, and every design decision in µ should be traceable to it.

- **The agent** reasons and orchestrates. It chooses which windows should exist and what
  they contain. It never writes UI code — it emits a *spec*, and only a spec.
- **The runtime** governs. It validates every spec against a known contract, applies the
  change to session state, renders the windows, resolves data, and tracks where every
  number came from. It trusts nothing the agent says until it has validated it.
- **The user** converses. They are never asked to operate a tool or configure a screen.
  They ask; the canvas answers.

The agent's authority is broad (it can build any view the runtime knows how to render) but
bounded (it can only speak in validated spec, and it can never touch keys, data, or the
DOM directly). That boundary is simultaneously the **safety model** and the
**extensibility model** — the same contract that keeps a misbehaving agent from doing harm
is the one a contributor implements to add a new window type.

### The loop

```text
User talks
  ↓
Agent reasons + calls tools
  ↓
Agent returns a Patch  (a list of operations on the playground)
  ↓
Runtime validates the patch against the renderer/data contract
  ↓
Runtime applies the patch to session state
  ↓
Canvas updates its windows; data bindings resolve; provenance is recorded
  ↓
User continues the conversation
```

The unit of change is a **patch** — a small, declarative list of operations
(*create a window*, *update a window*, *delete a window*, *focus a window*, *bind data*) —
not a full re-render. Patches are incremental, auditable, and easy for an agent to reason
about: it edits the playground the way you would edit a document.

---

## 4. The objects

These are conceptual; their precise schemas belong to the technical design.

- **Session.** The unit of work — one playground per conversation. It holds the windows,
  the data bindings, the citations, and the message history. A session is the thing you
  would later save, reopen, or share: a research thread with its evidence attached.

- **Window.** A typed view. The agent does not draw; it requests a window *of a known
  type* and fills in its spec. The first set is intentionally small: **price chart**,
  **indicator chart** (IV rank, realized vol, skew, factor scores), **table** (options
  chain, peer comparison, factor ranking), **memo** (the agent's written analysis), and
  **news / catalyst timeline**.

- **Data binding.** The seam between *where data comes from* and *how it is shown*. A
  binding names a **canonical data shape** (an OHLCV series, a numeric series, a news list,
  an options chain, a table) and the query or payload that fills it. Renderers bind to
  *shapes*, never to providers. This one indirection is what makes both sides modular: a
  new data source and a new window meet only at the shape.

- **Patch.** How the agent changes the playground (§3).

- **Citation / provenance.** Every claim and every number should be traceable. Windows and
  memos carry references back to the data binding and the source that produced them, so the
  user can always ask "where did this come from?" and get an answer.

---

## 5. How µ is expected to be used

A session, told as a story:

> **User:** *Analyze AMZN — price trend, recent news, and where options IV sits.*

The agent fetches a year of prices, six months of implied vol, and a month of news. It
returns a patch that creates four windows: a price chart with volume and moving averages, an
IV-rank / realized-vol panel, a news-and-catalyst timeline, and a memo summarizing what it
found. The canvas assembles itself as the agent's reply streams into the chat. Each window
carries its provenance.

> **User:** *Now compare it with GOOGL and MSFT.*

The agent returns another patch: it adds a peer-comparison table, perhaps a normalized
multi-line price chart, and updates the memo. Nothing was reconfigured by hand. The
interface followed the question.

Two properties matter here:

- **The user never leaves the conversation.** There is no screen to build, no widget to
  drag, no query language. The canvas is a consequence of asking.
- **The session is a research artifact.** When it is worth keeping, a session — windows,
  data, citations, and the dialogue that generated them — is a self-contained record of how
  a view of the world was reached. (Saving and sharing are future work, but the model is
  built for it from the start.)

Everything runs against *your* configuration: your agent, your data providers, your keys.
µ ships nothing you are not entitled to; it renders what your sources return.

---

## 6. How µ is expected to be built and extended

µ has two extension surfaces, and they are the point of the project. Everything else is
plumbing in service of these two.

### Renderers — the window types

A renderer turns a *validated window spec* plus its *bound data* into UI. It registers
itself with a manifest declaring the window type it serves, the spec schema it accepts, and
the data shape it requires. The runtime exposes the set of available renderers to the agent,
so the agent knows exactly what it is allowed to ask for — capability negotiation, not
guesswork.

Adding a window type means writing a renderer and registering it. The agent can use it the
moment it appears in the manifest. The renderer never reasons; it only draws.

### Providers — the data sources

A provider normalizes some third-party source — a market-data API, an options vendor, a
filings feed, a mock — into the **canonical data shapes**. It declares which shapes it can
supply and how to fetch them. A provider never touches UI; a renderer never touches a
provider. They meet only at the shape.

Adding a data source means writing a provider that maps it onto the shapes that already
exist. Existing renderers light up automatically, because they were never coupled to where
the data came from.

### The agent boundary

The agent sits behind a thin contract: it receives the current session, the user's message,
and the manifests of available tools and renderers; it returns an answer, an optional patch,
and citations. *What the agent is inside that boundary is not µ's concern.* Our default
backend is an [opencode](https://github.com/sst/opencode)-driven agent, but the contract is
deliberately small so the runtime never depends on a particular agent implementation.

### The trust model

- **Agent output is untrusted.** Every patch is validated against the contract before it
  touches state. An invalid or unknown spec is rejected, not rendered.
- **Renderers are trusted code** today (you run what you install). As the project opens to
  third-party renderers, sandboxing becomes a real concern — flagged now, designed for
  later.
- **Keys and entitlements are a hard boundary the agent never crosses.** Providers hold the
  credentials; the agent asks for *shapes*, not secrets; the user's data never becomes the
  agent's to leak.
- **Provenance is mandatory, not optional.** If a number is on screen, the runtime should be
  able to say where it came from.

---

## 7. Non-goals

What µ must never quietly become:

- **A financial research system.** µ has no opinion on what is a good trade, a fair value,
  or a sound thesis. It renders what the agent produces and records where it came from. The
  analysis is the agent's; the *faithful, safe rendering* is µ's.
- **A data vendor.** µ ships a mock provider and adapter patterns, never entitlements or
  redistributed feeds. Data is yours to bring.
- **An agent framework.** µ does not tell you how to build, prompt, or chain your agent. It
  defines a boundary and stays on its side of it.
- **Enterprise infrastructure.** No multi-tenancy, SSO, or RBAC ambitions in the early life
  of the project. µ is a single-user workbench first.
- **A TradingView / Bloomberg / OpenBB competitor.** Different posture, different size,
  different bet (§2).

The recurring temptation will be to let the runtime grow opinions about finance. It should
not. µ is UI infrastructure that happens to specialize in financial views — the
specialization lives in the *renderers and shapes*, not in the runtime's judgment.

---

## 8. Where µ sits

µ is not inventing the idea that an agent can drive a UI; it is applying a maturing idea to
a hard, specific domain. It is worth being honest about the neighborhood:

- There are emerging **protocols and specs** for agent-to-UI interaction and for declarative
  generative UI.
- There are **commercial generative-UI products** that turn model output into components.
- There are **agent-canvas experiments** where an agent drives a freeform surface through
  create/update/delete actions.
- There is a **well-funded vertical incumbent** in AI-native financial research, built as a
  hosted, enterprise platform.

µ's chosen ground is the intersection those mostly leave open: **vertical (finance) +
minimal + self-hosted + owned.** The generic players are not finance; the finance incumbent
is not minimal or yours to hack. µ's defensible value is not the protocol — it is *taste in
financial windows* and a clean contract a person can actually read and extend.

One consequence: **whether µ defines its own patch protocol or builds on an existing
standard is a genuine, open decision — and a technical one.** The product does not depend on
the answer; the loop in §3 is the same either way. That choice belongs to the
technical-decisions discussion, where it should be made on engineering merits and stated, in
the open, as a choice.

---

## 9. The bet

µ is a calling-card project before it is anything else. It succeeds if:

1. **The financial windows are good enough that a practitioner trusts them.** A mediocre
   IV panel or options chain makes the whole thing a toy. This is the bar that matters most.
2. **Adding a renderer or a provider is genuinely easy** — easy enough that the contract,
   not a tutorial, is the documentation.
3. **The agent→render loop feels alive** in the demo: you ask, and a real research view
   builds itself in front of you.

It is not trying to be a business, and it does not need to be one to be worth building. What
it demonstrates — judgment about how agents and interfaces should meet, exercised in a
domain where being wrong is obvious — is the point.

---

*Next: the technical-decisions discussion — protocol-vs-standard, the package boundaries,
the rendering and data-shape contracts, and the agent integration. None of it is settled by
this document, by design.*
