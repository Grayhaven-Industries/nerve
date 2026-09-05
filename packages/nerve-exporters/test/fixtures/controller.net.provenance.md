# Controller netlist fixture

`controller.net` is a hand-authored native KiCad S-expression netlist fixture. It is not a captured invocation of KiCad. Its component, field, library-pin, and node shapes follow the [official KiCad netlist example](https://docs.kicad.org/10.0/en/eeschema/eeschema.html#netlist-examples). The exact `pintype` suffix `+no_connect` follows `NETLIST_EXPORTER_XML::makeListOfNets` in [KiCad's exporter source](https://github.com/KiCad/kicad-source-mirror/blob/10.0/eeschema/netlist_exporters/netlist_exporter_xml.cpp), checked September 5, 2026.

`BOARD_J7` mirrors the eight-pin controller board fixture. `J_NC` exercises four distinct cases: a schematic NC flag, a library pin absent from the nets section, a library pin whose electrical type is `no_connect`, and a real signal whose name happens to start with `unconnected-`. No-connect intent must come from metadata, never from the name.

To export a real schematic in this format, run:

```sh
kicad-cli sch export netlist --format kicadsexpr --output controller.net controller.kicad_sch
```

This command and the `.net` extension are documented in the [official CLI reference](https://docs.kicad.org/10.0/en/cli/cli.html#schematic-export-netlist).
