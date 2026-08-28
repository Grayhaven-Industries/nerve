# @grayhaven/nerve-wireviz

WireViz YAML import/export adapter for Grayhaven Nerve, with diagnostics where concepts don't map cleanly.

The importer preserves WireViz's compact authoring features where they have an unambiguous Nerve representation:

- YAML anchors and merge keys, including an external prepend/template file
- named connector and cable instances such as `PLUG.J1` and `LOOM.CBL1`
- ascending and descending ranges such as `1-4` and `4-1`
- connector pin labels plus cable wire-label and unique color references
- numeric metre lengths and explicit `mm`, `cm`, `m`, `in`, or `ft` lengths

Template definitions used only to create named instances are not emitted as physical parts. Unsupported or lossy constructs produce `HK-WV-001` diagnostics; unnamed template instances currently require an explicit designator. Unknown top-level sections also produce an `HK-WV-001` warning naming the section, while `templates` remains available as a diagnostic-clean anchor container.

```bash
nerve import ./harness.yml --prepend-file ./templates.yml --out ./migration
```

Part of [Grayhaven Nerve](https://github.com/tylergibbs1/nerve) — harnesses as code. [Live demo + docs](https://nerve.grayhavenindustries.com) · [llms.txt](https://nerve.grayhavenindustries.com/llms.txt) · Apache-2.0
