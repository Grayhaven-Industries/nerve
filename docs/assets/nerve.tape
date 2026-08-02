Output nerve-demo.gif
Output nerve-demo.mp4

Set Shell bash
Set FontSize 15
Set Width 1500
Set Height 470
Set Padding 24
Set TypingSpeed 25ms
Set Theme "Catppuccin Mocha"

Hide
Type "clear" Enter
Show

Sleep 1s
Type "# Grayhaven Nerve — deterministic harness review."
Enter
Type "# A real harness: 22 connectors, 65 wires."
Enter
Sleep 1s

Type "./nerve validate ./src/main.harness.ts | tail -1"
Enter
Sleep 3s

Type ""
Enter
Type "# Clean. But clean is not the same as good —"
Enter
Type "# every rule also reports how close it came."
Enter
Sleep 1s

Type "./nerve review ./src/main.harness.ts | grep -A4 Tightest"
Enter
Sleep 4s

Type ""
Enter
Type "# That spine sleeve is at 95% fill. Nothing failed."
Enter
Sleep 2s

Type "clear"
Enter
Sleep 500ms

Type "# Now swap CAN_H and CAN_L on the IMU —"
Enter
Type "# and swap the wires to match, so the design agrees with itself."
Enter
Sleep 1s

Type "./nerve validate ./src/swapped.harness.ts --codes | grep HK-CONN"
Enter
Sleep 4s

Type ""
Enter
Type "# HK-CONN-011 compares wire to pin. Both written by the same"
Enter
Type "# author, so it sees nothing. HK-CONN-023 asks the part."
Enter
Sleep 3s

Type "clear"
Enter
Sleep 500ms

Type "# Last question: what does a clean report rest on?"
Enter
Sleep 1s

Type "./nerve provenance ./src/main.harness.ts | tail -3"
Enter
Sleep 4s

Type ""
Enter
Type "# 53 rules. Margins, not just verdicts. And an honest"
Enter
Type "# account of the evidence underneath. npm i @grayhaven/nerve"
Enter
Sleep 4s
