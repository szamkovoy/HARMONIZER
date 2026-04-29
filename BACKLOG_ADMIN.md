# Admin Backlog

## Analytics Foundation

The backend is already ready for internal analytics through `user_event_log`.

Current events:

- `llm_prompt_size` - written by LLM-backed flows to track compact DTO sizes and estimated token pressure.
- `dialog_turn` - written after communicator turns to track phase, decision source, orchestrator latency, first-token latency, and cache similarity.
- `api_error`, `llm_error`, `llm_timeout` - written by monitored endpoints for operational debugging and Phase 9 readiness.

## Future Admin Panel

The admin panel should visualize these events by user, endpoint, and time range:

- LLM token usage and p95 prompt size by endpoint.
- Dialogue latency, first-token latency, and decision cache hit rate.
- LLM errors and timeouts with endpoint/stage breakdown.
- Conversion funnel from dialog turn to selected practice.

The admin panel should also allow safe editing of rows in the `prompts` table:

- View active and inactive prompt versions.
- Create a new prompt version without mutating historical versions.
- Toggle `is_active` for controlled rollout.
- Compare prompt performance using `user_event_log` metrics.
