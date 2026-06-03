# µ

A session-driven generative-UI playground for financial research.

You bring an agent and your own data; µ turns the agent's structured output into
a live canvas of typed windows — price charts, indicator panels, tables, memos,
news timelines — sitting beside the conversation that produced them.

> **Status:** design complete, no code yet. See [docs/](docs/) — start with
> [docs/overview.md](docs/overview.md). Implementation is next.

## Principle

> Agent decides what to see. Runtime decides how to safely render it. User stays in the conversation.

The agent never writes UI code — it emits a validated spec, and µ renders it.

## License

[AGPL-3.0-only](LICENSE).
