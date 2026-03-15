# Spikes — Validation Experiments

Each spike validates a critical assumption before we build on it.

## How to test

Use `vfa` to launch Pi in a Docker container:

```bash
# Start a Pi session with a spike extension mounted
vfa session start --provider pi --prompt "test prompt here"

# Send follow-up prompts
vfa session send --prompt "follow-up"

# Close when done
vfa session close
```

For extensions, mount the spike directory into the container's Pi extensions path. See each spike's README for specific instructions.

## Spikes

| # | Question | Status | Result |
|---|----------|--------|--------|
| 01 | Does Pi's `context` event work for knowledge injection? | TODO | |
| 02 | Does `tool_call` blocking redirect the AI correctly? | TODO | |
| 03 | Does `better-sqlite3` work inside Pi packages? | TODO | |

## Results

Results are documented in each spike's directory after testing.
