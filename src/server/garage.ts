import { CARS, SPECS, DRIVE, carFits, parked, paved, type CarDef, type CarPose, type CarSeat, type CarState } from '../shared/garage.js';
import { citySolids, seaRespawnsFrom } from '../shared/city.js';
import { CITY_GATE } from '../shared/circuit.js';

/** How often one person can honk, at most (ms). */
const HONK_EVERY = 250;
/** A driver offers a ride this often at most (ms); an offer stands this long (ms); said no to, the same driver can't ask the same person again for this long (ms). */
export const OFFER_EVERY = 3000;
export const OFFER_FOR = 30_000;
const SNUBBED_FOR = 60_000;

/**
 * A floor's cars: who's in each one, and where its driver last said it is. Each driver's page drives
 * its own car (see shared/garage.ts) and the office passes it on. Nothing is saved: when the office
 * restarts, every car is back in its spot.
 */
export class Garage {
  private cars: CarState[];
  private honked = new Map<string, number>();
  /** When each car's pose was last accepted (ms), to tell a drive from a jump. */
  private movedAt: number[] = [];
  /** Rides offered: by who they're offered to, the driver offering and their car, until when. One each. */
  private offers = new Map<string, { from: string; car: number; until: number }>();
  /** When each driver last offered a ride, and who said no to whom, until when (`from>to`). */
  private offeredAt = new Map<string, number>();
  private snubbed = new Map<string, number>();

  /** A floor's garage; or the race circuit's cars (`defs`), which go anywhere `where` says (see shared/circuit.ts). */
  constructor(
    private now = () => Date.now(),
    private defs: readonly CarDef[] = CARS,
    private where: (x: number, z: number) => boolean = paved,
  ) {
    this.cars = parked(defs);
  }

  /** Every car as it is now, for the floor's pages. */
  state(): CarState[] {
    return this.cars.map((c) => ({ ...c }));
  }

  /** The car `id` is in, and which seat. */
  seatOf(id: string): { car: number; seat: CarSeat } | undefined {
    for (let i = 0; i < this.cars.length; i++) {
      if (this.cars[i].driver === id) return { car: i, seat: 'driver' };
      if (this.cars[i].passenger === id) return { car: i, seat: 'passenger' };
    }
    return undefined;
  }

  /** `id` gets into `seat` of car `car`, out of wherever they were: only if it's free. Says whether anything changed. */
  enter(id: string, car: number, seat: CarSeat): boolean {
    const c = this.cars[car];
    if (!c || (seat !== 'driver' && seat !== 'passenger') || c[seat] || (seat === 'passenger' && SPECS[this.defs[car].kind].seats < 2)) return false;
    this.leave(id);
    c[seat] = id;
    if (seat === 'driver') this.movedAt[car] = this.now();
    return true;
  }

  /**
   * The driver `from` offers `to` the empty seat beside them. Nobody is seated until they say yes
   * (accept). Only a driver with a free passenger seat, to someone not in a car, now and then, and not
   * again soon to someone who said no. The car it's for, if it stands.
   */
  offer(from: string, to: string): number | undefined {
    const at = this.seatOf(from);
    const now = this.now();
    if (!at || at.seat !== 'driver' || from === to || this.seatOf(to)) return undefined;
    if (SPECS[this.defs[at.car].kind].seats < 2 || this.cars[at.car].passenger) return undefined;
    if (now - (this.offeredAt.get(from) ?? -Infinity) < OFFER_EVERY || now < (this.snubbed.get(`${from}>${to}`) ?? 0)) return undefined;
    for (const [k, at] of this.offeredAt) if (now - at >= OFFER_EVERY) this.offeredAt.delete(k);
    this.offeredAt.set(from, now);
    this.offers.set(to, { from, car: at.car, until: now + OFFER_FOR });
    return at.car;
  }

  /** The ride offered to `to`, if there is one. */
  offerTo(to: string): { from: string; car: number; until: number } | undefined {
    return this.offers.get(to);
  }

  /**
   * `to` answers the ride `from` offered: yes is into the passenger seat, if the offer still stands
   * (still driving the same car, the seat still free, `to` in no car, in time). No is no, and the
   * driver can't ask again for a while. The car they got into.
   */
  answer(to: string, from: string, yes: boolean): number | undefined {
    const o = this.offers.get(to);
    if (!o || o.from !== from) return undefined;
    this.offers.delete(to);
    if (!yes) {
      this.snubbed.set(`${from}>${to}`, this.now() + SNUBBED_FOR);
      for (const [k, until] of this.snubbed) if (until <= this.now()) this.snubbed.delete(k);
      return undefined;
    }
    const at = this.seatOf(from);
    if (this.now() > o.until || at?.car !== o.car || at.seat !== 'driver' || this.seatOf(to)) return undefined;
    return this.enter(to, o.car, 'passenger') ? o.car : undefined;
  }

  /** `id` gets out (or left the floor, or the office). A car nobody's driving stops where it is. Says whether they were in one. */
  leave(id: string): boolean {
    this.honked.delete(id);
    this.offers.delete(id);
    const at = this.seatOf(id);
    if (!at) return false;
    const c = this.cars[at.car];
    delete c[at.seat];
    if (at.seat === 'driver') Object.assign(c, { speed: 0, steer: 0, slip: 0 });
    return true;
  }

  /**
   * The driver of car `car` says where it's got to: where the office has it now, to pass on. Nothing
   * from anyone else, or from out in the sea (anywhere on the island will do, off-road included; a car
   * that went into the sea comes back as a jump to the road: shared/city.ts shoreRespawn).
   */
  drive(id: string, car: number, pose: CarPose): CarPose | undefined {
    const c = this.cars[car];
    if (!c || c.driver !== id) return undefined;
    const { x, z, rotY, speed, steer } = pose;
    const slip = pose.slip ?? 0;
    const spec = SPECS[this.defs[car].kind];
    if (![x, z, rotY, speed, steer, slip].every(Number.isFinite) || !this.where(x, z)) return undefined;
    if (this.where === paved && !this.plausible(car, { x, z, rotY })) return undefined;
    this.movedAt[car] = this.now();
    Object.assign(c, {
      x,
      z,
      rotY: Math.atan2(Math.sin(rotY), Math.cos(rotY)),
      speed: Math.min(spec.top, Math.max(-spec.reverse, speed)),
      slip: spec.width < 1 ? 0 : Math.min(spec.top * 0.75, Math.max(-spec.top * 0.75, slip)),
      steer: Math.min(DRIVE.steer, Math.max(-DRIVE.steer, steer)),
    });
    return { x: c.x, z: c.z, rotY: c.rotY, speed: c.speed, steer: c.steer, slip: c.slip };
  }

  /**
   * Whether a city car can have got to `to` from where the office last had it: clear of the city's
   * buildings and street furniture, and no further than it could have gone since (flat out, with some
   * slack for the network). Two jumps are allowed: back onto the road out of the sea (only to one of
   * the spots shoreRespawns gives for the water by where it was), and out of the gate from the circuit.
   */
  private plausible(car: number, to: { x: number; z: number; rotY: number }): boolean {
    const kind = this.defs[car].kind;
    if (!carFits(to, citySolids(to.x, to.z, 6), kind)) return false;
    const c = this.cars[car];
    const seconds = Math.min(1, Math.max(0, (this.now() - (this.movedAt[car] ?? this.now())) / 1000));
    if (Math.hypot(to.x - c.x, to.z - c.z) <= SPECS[kind].top * 1.3 * seconds + 3) return true;
    const at = (p: { x: number; z: number }) => Math.hypot(p.x - to.x, p.z - to.z) < 0.5;
    return at(CITY_GATE.out) || seaRespawnsFrom(c.x, c.z).some(at);
  }

  /** `id` leans on the horn: the car they're in, unless they only just did. */
  honk(id: string): number | undefined {
    const at = this.seatOf(id);
    if (!at) return undefined;
    const now = this.now();
    if (now - (this.honked.get(id) ?? -Infinity) < HONK_EVERY) return undefined;
    this.honked.set(id, now);
    return at.car;
  }
}
