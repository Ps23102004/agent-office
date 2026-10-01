import { CIRCUIT, CIRCUIT_CARS } from '../shared/circuit';
import { CARS, SPECS } from '../shared/garage';
import { MEET_SPOTS, isMeetSpot, type MeetPin, type MeetSpotId } from '../shared/meet';
import type { ClientMsg, PeerInfo } from '../shared/protocol';
import { store } from './state';

// Doing things together, for the Hang out window, the chat and the palette to call: posting a meeting
// spot to the chat and going to one (shared/meet.ts), and offering a friend the seat beside you or
// taking the one you're offered (server/garage.ts offer/answer). main.ts wires them to the office and
// to getting you there. The office checks all of it; these only save asking for what it'd refuse.

interface Wiring {
  send(msg: ClientMsg): void;
  /** Takes you to a pinned spot: by elevator, the gate or on foot. */
  go(pin: MeetPin): void;
  /** Gets you ready to be seated in a car (stands you up, stops what you're doing); false, with a word why, if you can't be. */
  readyToRide(): boolean;
}

let wiring: Wiring | null = null;

/** main.ts, once it's ready. */
export function wireTogether(w: Wiring) {
  wiring = w;
}

export { MEET_SPOTS, type MeetPin, type MeetSpotId };

/** Posts `spot` to the office chat as a meeting spot (on or under your floor, for the office lounge and the circuit gate). */
export function postMeet(spot: MeetSpotId) {
  wiring?.send({ t: 'meet.post', spot });
}

/** Takes you to a meeting spot someone posted (a chat line's `meet`). */
export function goToMeet(pin: MeetPin) {
  if (isMeetSpot(pin.spot)) wiring?.go(pin);
}

/** What a pin is called, for a button: "🔥 the roof fire pit". */
export function meetLabel(pin: MeetPin): string {
  const s = MEET_SPOTS[pin.spot] as (typeof MEET_SPOTS)[MeetSpotId] | undefined;
  if (!s) return '';
  const floor = pin.floor && store.floors.find((f) => f.id === pin.floor)?.name;
  return `${s.icon} ${s.name}${floor ? ` (${floor})` : ''}`;
}

/** How near your car someone has to be to be offered a ride (m): a little inside the office's own reach. */
export const RIDE_REACH = 22;

/** Who you could offer the seat beside you to now: you're driving, it's free, and they're on your floor near the car, on foot. */
export function rideCandidates(): PeerInfo[] {
  const at = store.carOf(store.you);
  const car = at && store.cars[at.car];
  const def = at && (store.floor === CIRCUIT ? CIRCUIT_CARS : CARS)[at.car];
  if (!at || at.seat !== 'driver' || !car || !def || car.passenger || SPECS[def.kind].seats < 2) return [];
  return [...store.peers.values()].filter((p) => p.id !== store.you && !p.lite && store.onMyFloor(p) && !store.carOf(p.id) && Math.hypot(p.x - car.x, p.z - car.z) <= RIDE_REACH);
}

/** Offers the seat beside you to `id`: they're seated only if they say yes. */
export function offerRide(id: string) {
  wiring?.send({ t: 'car.invite', to: id });
}

/** The ride you've been offered, while it stands. */
export function rideOffer(): { from: string; name: string; car: number; until: number } | null {
  const o = store.rideOffer;
  return o && o.until > store.officeNow() ? o : null;
}

/** Says yes (into the seat, when the office seats you: 'car.seated') or no to the ride you were offered. */
export function answerRide(accept: boolean) {
  const o = rideOffer();
  store.rideOffer = null;
  store.emit('ride');
  if (!o || !wiring) return;
  // Can't get in after all (hands full, say): that's a no, so the driver isn't left waiting.
  wiring.send({ t: 'car.invite.answer', from: o.from, accept: accept && wiring.readyToRide() });
}
