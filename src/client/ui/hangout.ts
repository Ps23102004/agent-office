import { FLOOR, inWing, WING } from '../../shared/layout';
import type { PeerInfo } from '../../shared/protocol';
import { ROOF } from '../../shared/rooftop';
import type { Net } from '../net';
import { store } from '../state';
import type { Voice } from '../voice';
import { inviteLink, openAccounts } from './accounts';
import { focusDialog } from './dialog-focus';
import { h, openModal, type Modal } from './dom';
import { copy, openTeam } from './team';
import { whereabouts } from './whereabouts';

export interface HangoutOptions {
  net: Net;
  voice: Pick<Voice, 'inVoice' | 'muted'>;
  toggleVoice(): void | Promise<void>;
  /** Use the existing friend walk/elevator route. W2 can extend that route to the circuit. */
  jumpTo(id: string): void;
  peerAtCircuit(peer: PeerInfo): boolean;
  /** A route that isn't connected yet says why, rather than taking a friend to the wrong place. */
  jumpBlocked?(peer: PeerInfo): string | undefined;
}

let current: Modal | null = null;
const text = (el: HTMLElement, value: string) => { if (el.textContent !== value) el.textContent = value; };

/** Where they are, alongside the richer activity line from whereabouts(). */
function place(p: PeerInfo, opts: HangoutOptions): string {
  if (p.lite) return '2D view';
  if (opts.peerAtCircuit(p)) return 'Circuit';
  if (p.floor === ROOF) return 'Roof';
  const floor = store.floors.find((f) => f.id === p.floor)?.name;
  if (store.plan().style !== 'office') return [store.plan().name, floor].filter(Boolean).join(' · ');
  const outside = p.y < -1 || p.x < FLOOR.minX || p.x > FLOOR.maxX || p.z < FLOOR.minZ || p.z > FLOOR.maxZ;
  const wing = p.y > -1 && inWing(p.x, p.z, WING.rows);
  return `${outside && !wing ? 'City' : 'Office'}${floor ? ` · ${floor}` : ''}`;
}

/** Find friends, get into voice or send an invite, without another voice or navigation implementation. */
export function openHangout(opts: HangoutOptions) {
  if (current) return current.el.querySelector<HTMLElement>('button')?.focus();
  const status = h('p.hangout-status', { role: 'status', 'aria-live': 'polite' });
  const feedback = h('p.note', { role: 'status', 'aria-live': 'polite' });
  let changingVoice = false;
  const voice = h('button.btn', { type: 'button' }, 'Join voice');
  const invite = h('button.btn', { type: 'button' }, 'Copy office link');
  const inviteHelp = h('p.note');
  const list = h('ul.hangout-people', { 'aria-label': 'Friends in the office' });
  const rows = new Map<string, { el: HTMLElement; name: HTMLElement; where: HTMLElement; activity: HTMLElement; voice: HTMLElement; go: HTMLButtonElement }>();
  const access = h('button.btn', { type: 'button', onclick: () => { current?.close(); openTeam(opts.net); } }, 'Invite teammates…');
  const el = h('div.modal.hangout-window', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Hang out' },
    h('header', {}, h('h2', {}, '👋 Hang out')),
    h('div.body', {}, status, h('div.hangout-actions', {}, voice, invite, access), inviteHelp, feedback,
      h('h3', {}, 'Who’s around'), list),
    h('footer', {}, h('span.grow', {}, h('span.key', {}, 'G'), 'hold for the emote wheel · ', h('span.key', {}, '1–6'), 'quick emotes · ', h('span.key', {}, 'V'), 'hold to talk')));
  const openInvite = () => [...(store.me.admin ? store.accounts?.invites ?? [] : [])].find((v) => !v.name && v.role === 'member' && v.expiresAt > Date.now());
  const render = () => {
    const peers = [...store.peers.values()];
    const talking = peers.filter((p) => p.id === store.you ? opts.voice.inVoice : p.voice).length;
    text(status, `${peers.length} here · ${talking} in voice${opts.voice.inVoice ? opts.voice.muted ? ' · You’re muted' : ' · Your mic is on' : ''}`);
    text(voice, opts.voice.inVoice ? 'Leave voice' : 'Join voice');
    voice.disabled = changingVoice || !window.isSecureContext;
    voice.title = !window.isSecureContext ? 'Voice needs HTTPS or localhost' : 'V joins voice; in voice, hold V to talk. M mutes or unmutes.';
    text(invite, openInvite() ? 'Copy invite link' : store.me.admin ? 'Make invite link…' : 'Copy office link');
    access.classList.toggle('hidden', !store.invites);
    text(inviteHelp, openInvite() ? 'This account invite works once. For a named invite, open Accounts from the menu.' : store.me.admin ? 'Make an account invite, then copy its link from Accounts.' : 'An office link still needs an account or the office password. Ask an admin for an account invite.');
    const seen = new Set<string>();
    for (const p of peers) {
      seen.add(p.id);
      let row = rows.get(p.id);
      if (!row) {
        const name = h('strong');
        const where = h('span.hangout-place');
        const activity = h('small');
        const mic = h('span.hangout-mic');
        const go = h('button.btn', { type: 'button', onclick: () => { current?.close(); opts.jumpTo(p.id); } }, 'Go to friend');
        const item = h('li', {}, h('div.hangout-person', {}, name, where, activity), mic, go);
        row = { el: item, name, where, activity, voice: mic, go };
        rows.set(p.id, row);
        list.append(item);
      }
      text(row.name, `${p.name}${p.id === store.you ? ' (you)' : ''}`);
      text(row.where, place(p, opts));
      text(row.activity, whereabouts(p, store.carOf(p.id)) ?? 'Just hanging out');
      const inVoice = p.id === store.you ? opts.voice.inVoice : p.voice;
      const muted = p.id === store.you ? opts.voice.muted : p.muted;
      text(row.voice, inVoice ? muted ? '🔇 Muted' : '🎙️ In voice' : 'Out of voice');
      const reason = p.id === store.you ? 'You’re here' : p.lite ? 'On the 2D view' : !p.floor && !store.onMyFloor(p) ? 'No place to go to yet' : opts.jumpBlocked?.(p);
      row.go.disabled = !!reason;
      text(row.go, p.id === store.you ? 'You’re here' : 'Go to friend');
      row.go.title = reason ?? `Walk over to ${p.name}, taking the elevator if needed`;
      row.go.setAttribute('aria-label', reason ? `${p.name}: ${reason}` : `Go to ${p.name}`);
    }
    for (const [id, row] of rows) if (!seen.has(id)) { row.el.remove(); rows.delete(id); }
    if (!peers.length) {
      if (!list.querySelector('.empty')) list.append(h('li.empty', {}, 'Nobody here yet. Invite a friend to join you.'));
    } else list.querySelector('.empty')?.remove();
  };
  voice.addEventListener('click', async () => {
    changingVoice = true;
    render();
    try { await opts.toggleVoice(); }
    catch { text(feedback, 'Could not change voice. Try again.'); }
    finally { changingVoice = false; if (el.isConnected) render(); }
  });
  invite.addEventListener('click', async () => {
    const accountInvite = openInvite();
    if (!accountInvite && store.me.admin) { current?.close(); return openAccounts(opts.net); }
    const url = accountInvite ? inviteLink(accountInvite) : `${location.origin}/`;
    try { text(feedback, await copy(url) ? accountInvite ? 'Invite link copied.' : 'Office link copied.' : 'Copy failed. Try again from the menu’s invite window.'); }
    catch { text(feedback, 'Copy failed. Try again from the menu’s invite window.'); }
  });
  const unsubs = (['peers', 'floors', 'cars', 'accounts', 'me', 'map', 'team'] as const).map((topic) => store.on(topic, render));
  // Poses change without emitting peers; look again while this window is open, and stop on close.
  const timer = window.setInterval(render, 1000);
  let releaseFocus = () => {};
  current = openModal(el, { doing: '👋 finding friends', onClose: () => { window.clearInterval(timer); unsubs.forEach((off) => off()); current = null; releaseFocus(); } });
  render();
  releaseFocus = focusDialog(el);
  if (store.me.admin) opts.net.send({ t: 'accounts.get' });
}
