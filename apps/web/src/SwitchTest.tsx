import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { HardwareSnapshot } from './hardware.js';
import { switchTestEntries } from './switch-test.js';
import type { ReceivedMessage, SwitchCandidate } from './switch-test.js';

const TEXT = {
  en: {
    title: 'Test switches',
    intro: 'Press the Chocolate\'s switches while it is connected here (switch on U). Each MIDI message it sends is listed with the switches whose configuration, as read from the Chocolate, sends that message. Nothing is sent to the Chocolate.',
    caveat: 'A match shows a configuration, not which press happened: the same message can be set on several switches. Whether the receiving equipment responds is a separate test on that equipment.',
    needRead: 'Read the Chocolate first to compare what it sends with its configuration.',
    start: 'Start test', stop: 'Stop', clear: 'Clear',
    waiting: 'No MIDI received since the test started. Press a switch. If nothing appears, this controller mode or firmware may not send switch MIDI over USB while connected for configuration (not verified).',
    stopped: 'Start the test, then press the switches.',
    noMatch: 'No switch in the read configuration sends this.',
    matches: 'Configured on:',
    group: 'Group', primary: 'tap / sequence 1', secondary: 'hold / sequence 2', step: 'message {{n}} of {{of}}',
    pc: 'PC {{program}} (preset slot {{display}})', cc: 'CC {{controller}} = {{value}}', note: 'Note {{note}} vel {{velocity}}',
    noteOn: 'Note on', noteOff: 'Note off', other: 'Other MIDI', channel: 'ch',
  },
  'pt-BR': {
    title: 'Testar botões',
    intro: 'Pise nos botões do Chocolate com ele conectado aqui (chave em U). Cada mensagem MIDI que ele envia aparece com os botões cuja configuração, lida do Chocolate, envia essa mensagem. Nada é enviado ao Chocolate.',
    caveat: 'A correspondência mostra uma configuração, não qual pisada aconteceu: a mesma mensagem pode estar em vários botões. Se o equipamento de destino responde é outro teste, feito nele.',
    needRead: 'Leia o Chocolate primeiro para comparar o que ele envia com a configuração dele.',
    start: 'Iniciar teste', stop: 'Parar', clear: 'Limpar',
    waiting: 'Nenhuma mensagem MIDI desde o início do teste. Pise num botão. Se nada aparecer, este modo ou firmware pode não enviar o MIDI dos botões pela USB enquanto conectado para configuração (não verificado).',
    stopped: 'Inicie o teste e pise nos botões.',
    noMatch: 'Nenhum botão da configuração lida envia isto.',
    matches: 'Configurado em:',
    group: 'Grupo', primary: 'toque / sequência 1', secondary: 'segurar / sequência 2', step: 'mensagem {{n}} de {{of}}',
    pc: 'PC {{program}} (slot de preset {{display}})', cc: 'CC {{controller}} = {{value}}', note: 'Nota {{note}} vel {{velocity}}',
    noteOn: 'Nota ligada', noteOff: 'Nota desligada', other: 'Outro MIDI', channel: 'canal',
  },
} as const;
type Key = keyof typeof TEXT.en;

function fill(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => String(values[key] ?? ''));
}

export function SwitchTest({ state }: { state: HardwareSnapshot }) {
  const { i18n } = useTranslation();
  const locale = i18n.language === 'pt-BR' ? 'pt-BR' : 'en';
  const tx = (key: Key, values: Record<string, string | number> = {}) => fill(TEXT[locale][key], values);
  const [since, setSince] = useState<number | null>(null);
  const configuration = state.verified?.configuration ?? state.observed?.configuration ?? null;
  const entries = useMemo(() => since === null ? [] : switchTestEntries(state.history, since, configuration, locale),
    [state.history, since, configuration, locale]);

  const describe = (message: ReceivedMessage) => {
    if (message.type === 'pc') return `${tx('pc', { program: message.program, display: message.program + 1 })} · ${tx('channel')} ${message.channel}`;
    if (message.type === 'cc') return `${tx('cc', { controller: message.controller, value: message.value })} · ${tx('channel')} ${message.channel}`;
    if (message.type === 'other') return `${tx('other')} 0x${message.status.toString(16).toUpperCase()}`;
    return `${tx(message.type === 'note-on' ? 'noteOn' : 'noteOff')} · ${tx('note', { note: message.note, velocity: message.velocity })} · ${tx('channel')} ${message.channel}`;
  };
  const where = (candidate: SwitchCandidate) => {
    const sequence = candidate.sequence === 'gesture' ? candidate.gesture ?? '' : tx(candidate.sequence);
    const step = candidate.length > 1 ? ` · ${tx('step', { n: candidate.position + 1, of: candidate.length })}` : '';
    return `${tx('group')} ${candidate.groupIndex + 1} (${candidate.groupName}) · ${candidate.switchId} · ${sequence}${step}${candidate.action ? ` — ${candidate.action}` : ''}`;
  };

  if (state.status !== 'connected' && state.status !== 'busy') return null;
  return <details className="switch-test">
    <summary>{tx('title')}</summary>
    <p className="helper">{tx('intro')}</p>
    <p className="helper">{tx('caveat')}</p>
    {!configuration && <p role="status">{tx('needRead')}</p>}
    <div className="button-row">
      {since === null
        ? <button className="secondary" onClick={() => setSince(Date.now())}>{tx('start')}</button>
        : <><button className="secondary" onClick={() => setSince(null)}>{tx('stop')}</button>
          <button className="text-button" onClick={() => setSince(Date.now())}>{tx('clear')}</button></>}
    </div>
    {since === null ? <p className="helper">{tx('stopped')}</p>
      : !entries.length ? <p role="status">{tx('waiting')}</p>
      : <ol className="switch-test-list" aria-live="polite">{entries.map(entry => <li key={entry.id}>
        <span className="switch-test-time">{new Date(entry.time).toLocaleTimeString(i18n.language)}</span>
        <strong>{describe(entry.message)}</strong>
        {configuration && (entry.message.type === 'pc' || entry.message.type === 'cc') && (entry.candidates.length
          ? <div><span className="helper">{tx('matches')}</span><ul>{entry.candidates.map((candidate, index) => <li key={index}>{where(candidate)}</li>)}</ul></div>
          : <div className="helper">{tx('noMatch')}</div>)}
      </li>)}</ol>}
  </details>;
}
