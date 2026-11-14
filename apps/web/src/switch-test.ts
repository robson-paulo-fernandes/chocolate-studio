import { SWITCH_IDS, getEquipmentProfile, localizeEquipmentText } from '@chocolate-studio/midi';
import type { EquipmentLocale, MidiMessage, StudioConfiguration, SwitchId } from '@chocolate-studio/midi';
import type { HardwareEvent } from './hardware.js';

/**
 * Physical switch test: what the Chocolate sends when a switch is pressed, set against the configuration read
 * from it. Read-only: nothing is sent. A received message only says which configured sequences could have sent it;
 * it never proves which press happened (the same message may be configured on several switches, and another
 * sender on the same port would look the same).
 */

export type ReceivedMessage =
  | { type: 'pc'; channel: number; program: number }
  | { type: 'cc'; channel: number; controller: number; value: number }
  | { type: 'note-on' | 'note-off'; channel: number; note: number; velocity: number }
  | { type: 'other'; status: number };

export function decodeChannelMessage(bytes: readonly number[]): ReceivedMessage | null {
  const status = bytes[0];
  if (status === undefined || status < 0x80 || status === 0xf0) return null;
  const kind = status & 0xf0;
  const channel = (status & 0x0f) + 1;
  const data = (index: number) => {
    const value = bytes[index];
    return value !== undefined && value >= 0 && value <= 127 ? value : null;
  };
  if (kind === 0xc0) { const program = data(1); return program === null ? null : { type: 'pc', channel, program }; }
  if (kind === 0xb0) {
    const controller = data(1); const value = data(2);
    return controller === null || value === null ? null : { type: 'cc', channel, controller, value };
  }
  if (kind === 0x90 || kind === 0x80) {
    const note = data(1); const velocity = data(2);
    if (note === null || velocity === null) return null;
    return { type: kind === 0x90 && velocity > 0 ? 'note-on' : 'note-off', channel, note, velocity };
  }
  return { type: 'other', status };
}

export type SequenceKind = 'primary' | 'secondary' | 'gesture';

export interface SwitchCandidate {
  groupIndex: number;
  groupName: string;
  switchId: SwitchId;
  sequence: SequenceKind;
  /** for 'gesture': the gesture of actions[1..] */
  gesture?: string;
  /** 0-based position in the sequence and its length, e.g. the PC after a bank select */
  position: number;
  length: number;
  /** "Destination · action" when the sequence comes from an equipment profile action */
  action?: string;
}

/** The single MIDI events a configured message expands to on the wire (bank select first, as written). */
function wireEvents(message: MidiMessage): ReceivedMessage[] {
  if (message.type === 'cc') return [{ type: 'cc', channel: message.channel, controller: message.controller, value: message.value }];
  const events: ReceivedMessage[] = [];
  if (message.bank?.msb !== undefined) events.push({ type: 'cc', channel: message.channel, controller: 0, value: message.bank.msb });
  if (message.bank?.lsb !== undefined) events.push({ type: 'cc', channel: message.channel, controller: 32, value: message.bank.lsb });
  events.push({ type: 'pc', channel: message.channel, program: message.program });
  return events;
}

function same(a: ReceivedMessage, b: ReceivedMessage): boolean {
  if (a.type === 'pc' && b.type === 'pc') return a.channel === b.channel && a.program === b.program;
  if (a.type === 'cc' && b.type === 'cc') return a.channel === b.channel && a.controller === b.controller && a.value === b.value;
  return false;
}

export function findCandidates(configuration: StudioConfiguration, received: ReceivedMessage, locale: EquipmentLocale): SwitchCandidate[] {
  if (received.type !== 'pc' && received.type !== 'cc') return [];
  const out: SwitchCandidate[] = [];
  configuration.groups.forEach((group, groupIndex) => {
    for (const switchId of SWITCH_IDS) {
      const pedal = group.switches[switchId];
      const sequences: { kind: SequenceKind; gesture?: string; messages: readonly MidiMessage[] }[] = [
        { kind: 'primary', messages: pedal.actions[0]?.messages ?? [] },
        { kind: 'secondary', messages: pedal.secondaryMessages ?? [] },
        ...pedal.actions.slice(1).map(action => ({ kind: 'gesture' as const, gesture: action.gesture, messages: action.messages })),
      ];
      for (const sequence of sequences) {
        const events = sequence.messages.flatMap(wireEvents);
        events.forEach((event, position) => {
          if (!same(event, received)) return;
          const binding = sequence.kind === 'gesture' ? undefined : pedal.actionBindings?.[sequence.kind];
          const profile = binding && getEquipmentProfile(binding.modelId, binding.profileVersion);
          const action = profile?.actions.find(entry => entry.id === binding!.actionId);
          const destination = binding && configuration.destinations.find(entry => entry.id === binding.destinationId);
          out.push({
            groupIndex, groupName: group.name, switchId, sequence: sequence.kind, position, length: events.length,
            ...(sequence.gesture ? { gesture: sequence.gesture } : {}),
            ...(action && destination ? { action: `${destination.name} · ${localizeEquipmentText(action.label, locale)}` } : {}),
          });
        });
      }
    }
  });
  return out;
}

export interface TestEntry {
  id: string;
  time: number;
  bytes: number[];
  message: ReceivedMessage;
  candidates: SwitchCandidate[];
}

/** Incoming non-SysEx MIDI from the hardware history, newest first, from `since` on. */
export function switchTestEntries(history: readonly HardwareEvent[], since: number, configuration: StudioConfiguration | null,
  locale: EquipmentLocale): TestEntry[] {
  const entries: TestEntry[] = [];
  for (const event of history) {
    if (event.direction !== 'in' || event.kind !== 'midi' || event.time < since || !event.bytes) continue;
    const message = decodeChannelMessage(event.bytes);
    if (!message) continue;
    entries.push({ id: event.id, time: event.time, bytes: event.bytes, message,
      candidates: configuration ? findCandidates(configuration, message, locale) : [] });
  }
  return entries.reverse();
}
