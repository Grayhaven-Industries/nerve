# @grayhaven/nerve-cli

The `nerve` command line: `init / compile / validate / render / export / import / diff / inspect / quote / analyze / machine / contract / release / record / redline`. Deterministic output, CI-ready exit codes.

```bash
npx --package=@grayhaven/nerve-cli nerve init .
npx --package=@grayhaven/nerve-cli nerve export ./src/main.harness.ts
# dist/ -> drawings, CSVs, test plan, PDF packet, zip
npx --package=@grayhaven/nerve-cli nerve --version
```

Mapped CSV and Excel migrations emit a reviewable TypeScript project and immediately compile it to `harness.json`:

```bash
npx --package=@grayhaven/nerve-cli nerve import ./wire-list.csv \
  --map ./columns.json --out ./migration
```

Manufacturing exports use `dist/.nerve-export-incomplete` as a durable safety signal. The marker is created before any loose packet artifact and removed only after `manufacturing-packet.zip` is completely written. If the process is interrupted or a write fails and the marker remains, do not use the partial packet; rerun the export successfully.

Part of [Grayhaven Nerve](https://github.com/tylergibbs1/nerve) — harnesses as code. [Live demo + docs](https://nerve.grayhavenindustries.com) · [llms.txt](https://nerve.grayhavenindustries.com/llms.txt) · Apache-2.0
