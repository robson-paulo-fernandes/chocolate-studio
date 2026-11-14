// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { applyEquipmentAction, createDefaultConfiguration } from '@chocolate-studio/midi';
import type { StudioConfiguration } from '@chocolate-studio/midi';
import { decodeChannelMessage, findCandidates, pressedSwitches, switchTestEntries } from '../src/switch-test.js';
import { SwitchTest } from '../src/SwitchTest.js';
import type { HardwareEvent, HardwareSnapshot } from '../src/hardware.js';
import { i18n, initializeLanguage } from '../src/i18n.js';

const midiIn = (bytes: number[], time: number, id = `e${time}`): HardwareEvent =>
  ({ id, time, direction: 'in', kind: 'midi', summary: 'MIDI', bytes });

/** Group 1 from the default configuration (A–D = PC 0–3 on channel 1), plus a bank-selected PC on group 1 D. */
function configuration(): StudioConfiguration {
  const value = createDefaultConfiguration();
  value.groups[0]!.switches.D.actions[0]!.messages = [{ type: 'pc', channel: 1, program: 3, bank: { msb: 2 }, destinationId: 'destination-1' }];
  value.groups.push({ ...structuredClone(value.groups[0]!), id: 'group-2', name: 'Group 2' });
  return value;
}

describe('decodeChannelMessage', () => {
  it.each([
    [[0xc0, 5], { type: 'pc', channel: 1, program: 5 }],
    [[0xb3, 39, 127], { type: 'cc', channel: 4, controller: 39, value: 127 }],
    [[0x90, 60, 100], { type: 'note-on', channel: 1, note: 60, velocity: 100 }],
    [[0x90, 60, 0], { type: 'note-off', channel: 1, note: 60, velocity: 0 }],
    [[0xe0, 0, 64], { type: 'other', status: 0xe0 }],
  ])('decodes %j', (bytes, expected) => expect(decodeChannelMessage(bytes)).toEqual(expected));

  it.each([[[0xf0, 1, 0xf7]], [[0x40]], [[]], [[0xc0]], [[0xb0, 200, 1]]])('ignores SysEx, data and truncated bytes %j', (bytes) => {
    expect(decodeChannelMessage(bytes)).toBeNull();
  });
});

describe('findCandidates', () => {
  it('lists every switch configured with the message (it never picks one)', () => {
    const found = findCandidates(configuration(), { type: 'pc', channel: 1, program: 1 }, 'en');
    expect(found.map(c => `${c.groupIndex}:${c.switchId}:${c.sequence}`)).toEqual(['0:B:primary', '1:B:primary']);
  });

  it('matches bank select and program as positions of one sequence', () => {
    const found = findCandidates(configuration(), { type: 'cc', channel: 1, controller: 0, value: 2 }, 'en');
    expect(found[0]).toMatchObject({ switchId: 'D', position: 0, length: 2 });
    expect(findCandidates(configuration(), { type: 'pc', channel: 1, program: 3 }, 'en')[0]).toMatchObject({ switchId: 'D', position: 1, length: 2 });
  });

  it('does not match another channel or value', () => {
    expect(findCandidates(configuration(), { type: 'pc', channel: 2, program: 1 }, 'en')).toEqual([]);
    expect(findCandidates(configuration(), { type: 'cc', channel: 1, controller: 0, value: 3 }, 'en')).toEqual([]);
  });

  it('names the equipment action of a profile binding', () => {
    let value = createDefaultConfiguration();
    value = { ...value, destinations: [{ id: 'destination-1', name: 'Nano', channel: 3 }] };
    value = applyEquipmentAction(value, 'group-1', 'A', 'primary', {
      modelId: 'neuraldsp.nano-cortex', profileVersion: '0.1.0', actionId: 'fx-3-on', parameters: {}, destinationId: 'destination-1',
    });
    const [candidate] = findCandidates(value, { type: 'cc', channel: 3, controller: 39, value: 127 }, 'pt-BR');
    expect(candidate).toMatchObject({ switchId: 'A', sequence: 'primary' });
    expect(candidate!.action).toBe('Nano · Ligar FX slot 3');
  });
});

describe('switchTestEntries', () => {
  it('keeps incoming non-SysEx MIDI from the start time, newest first', () => {
    const history: HardwareEvent[] = [
      midiIn([0xc0, 0], 100), midiIn([0xc0, 1], 300),
      { ...midiIn([0xf0, 0x7f, 0xf7], 400), summary: 'SysEx' },
      { ...midiIn([0xc0, 2], 500), direction: 'out' },
      midiIn([0xc0, 2], 600),
    ];
    const entries = switchTestEntries(history, 200, configuration(), 'en');
    expect(entries.map(entry => entry.time)).toEqual([600, 300]);
    expect(entries[0]!.candidates.map(c => c.switchId)).toEqual(['C', 'C']);
  });
});

describe('SwitchTest panel', () => {
  beforeAll(async () => { await initializeLanguage(); await i18n.changeLanguage('pt-BR'); });
  afterEach(cleanup);
  const snapshot = (patch: Partial<HardwareSnapshot>): HardwareSnapshot => ({
    status: 'connected', reason: null, inputs: [], outputs: [], selection: null, identity: null,
    capabilities: { read: true, write: true, restore: true } as HardwareSnapshot['capabilities'],
    observed: null, verified: null, baseline: null, history: [], connectionEpoch: 1, backupSafety: null, ...patch,
  } as HardwareSnapshot);

  it('is hidden while disconnected', () => {
    const { container } = render(<SwitchTest state={snapshot({ status: 'disconnected' })} />);
    expect(container.textContent).toBe('');
  });

  it('asks for a read, then lists received messages with their configured switches', () => {
    const { rerender } = render(<SwitchTest state={snapshot({})} />);
    expect(screen.getByText('Leia o Chocolate primeiro para comparar o que ele envia com a configuração dele.')).toBeTruthy();
    const observed = { configuration: configuration(), rawBackup: {} as never, readAt: 1, warnings: [] };
    rerender(<SwitchTest state={snapshot({ observed })} />);
    fireEvent.click(screen.getByText('Iniciar teste'));
    rerender(<SwitchTest state={snapshot({ observed, history: [midiIn([0xc0, 1], Date.now() + 1000)] })} />);
    expect(screen.getByText(/PC 1 \(slot de preset 2\)/)).toBeTruthy();
    expect(screen.getAllByText(/Grupo \d \(Group \d\) · B · toque/)).toHaveLength(2);
  });
});

describe('pressedSwitches', () => {
  const state = (history: HardwareEvent[], status: HardwareSnapshot['status'] = 'connected') => ({ status, history });
  it('names the switches of the edited group configured with the newest recent message', () => {
    const pressed = pressedSwitches(state([midiIn([0xc0, 0], 900, 'old'), midiIn([0xc0, 2], 1000, 'new')]), configuration(), 'group-1', 1500);
    expect(pressed).toEqual({ id: 'new', switches: ['C'] });
  });
  it('ignores SysEx replies, stale messages, other groups and a disconnected controller', () => {
    expect(pressedSwitches(state([midiIn([0xc0, 1], 1000), { ...midiIn([0xf0, 0x7f, 0xf7], 1100), summary: 'SysEx' }]), configuration(), 'group-1', 1200))
      .toEqual({ id: 'e1000', switches: ['B'] });
    expect(pressedSwitches(state([midiIn([0xc0, 1], 1000)]), configuration(), 'group-1', 4000)).toBeUndefined();
    expect(pressedSwitches(state([midiIn([0xc0, 9], 1000)]), configuration(), 'group-1', 1100)).toBeUndefined();
    expect(pressedSwitches(state([midiIn([0xc0, 1], 1000)], 'disconnected'), configuration(), 'group-1', 1100)).toBeUndefined();
  });
});
