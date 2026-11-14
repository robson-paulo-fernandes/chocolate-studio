# Neural DSP Nano Cortex destination profile

Status: catalog data, not a hardware qualification. Exact destination model: **Neural DSP Nano Cortex**, ID `neuraldsp.nano-cortex`, profile `0.1.0`. Do not substitute a Quad Cortex or a plug-in. Every action is `hardwareVerification: not-tested`.

## Primary evidence

- **[Nano Cortex User Manual, 2.2.0 (NanOS 2.2.0)](https://neuraldsp.com/manual/nano-cortex)**, Neural DSP. The manufacturer publishes it as a web page only (no PDF), so citations name **section anchors** of that page, not PDF pages:
  - `#Incoming-MIDI-CC-List` — Cortex Cloud App / Incoming MIDI CC List
  - `#Incoming-MIDI-Support` — Program Change Preset Recall, TRS MIDI Type-A Routing
  - `#Device-Settings` — EXP/MIDI INPUT BEHAVIOR, MIDI CHANNEL
  - `#Expression-Pedal-Configuration`
- [Using MIDI on Nano Cortex](https://neuraldsp.com/getting-started/using-midi-on-nano-cortex), Neural DSP, consulted for corroboration of PC 0–63, USB-C and TRS Type-A input.

Only the manufacturer's documentation supplies destination commands. No community implementation is the source of a command.

## Documented incoming MIDI

| Musical action / ação musical | MIDI intent | Manual range and interpretation |
| --- | --- | --- |
| Select preset / Selecionar preset | PC `presetNumber - 1` | Preset slots 1–64 = PC 0–63. No incoming bank select documented; no CC0/CC32 prefix. |
| Gate on / off | CC34 = 127 / 0 | Input Gate slot bypass: 0–63 off, 64–127 on. |
| Capture on / off | CC35 = 127 / 0 | Capture slot bypass: 0–63 off, 64–127 on. |
| CAB/IR on / off | CC36 = 127 / 0 | CAB/IR slot bypass: 0–63 off, 64–127 on. |
| FX slot 1–5 on / off | CC37–CC41 = 127 / 0 | Effects slot bypass: 0–63 off, 64–127 on. Separate on and off actions: idempotent, no hidden toggle state. |
| Tap tempo / Marcar tempo | CC42 = 127 | Any value 0–127 registers one tap. One invocation is one tap, not a BPM value. |
| Tuner on / off | CC43 = 127 / 0 | 0–63 off, 64–127 on. Separate enter/exit actions. |
| Expression position / Posição da expressão | CC1 = 0–127 | 0 heel, 127 toe. Moves what the preset assigns to expression; a fixed switch value is not continuous movement. |

The 0/127 values are canonical members of the documented ranges.

## Connection

- Input: **USB-C** (direct USB MIDI) or the **EXP/MIDI jack as TRS MIDI Type-A** when it is set to MIDI in Cortex Cloud. The jack is either MIDI or an expression pedal, not both. MIDI is not received over Bluetooth (Bluetooth is for the app).
- Channel: Device Settings sets the base MIDI channel. The manual states no factory default.

## Not covered

- Incoming bank select and per-parameter CCs are not documented (listed as `unavailable`).
- MIDI clock: the NanOS 2.1.0 release notes mention a clock source setting, but the manual's incoming list has no clock entry and this catalog has no clock binding.

## Evidence boundary

Schema-valid and manufacturer-documented. Not stored/readback-verified on a Chocolate, and not destination-response-verified on a Nano Cortex. A physical test should send each action from a Chocolate and observe the Nano.
