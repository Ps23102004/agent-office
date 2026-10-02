/** The title and the in-game controls show the same keys. */
export type ControlMode = 'Walking' | 'Driving' | 'Racing' | 'Arena' | 'Everywhere';
export const CONTROLS: Record<ControlMode, [keys: string[], what: string][]> = {
  Walking: [
    [['W', 'A', 'S', 'D'], 'Walk'],
    [['Shift'], 'Run'],
    [['Space'], 'Jump'],
    [['Mouse'], 'Look around (click the office first)'],
    [['Z'], 'Change camera'],
    [['E'], 'Use whatever you’re next to'],
    [['T'], 'Chat'],
    [['V'], 'Talk (hold)'],
    [['G'], 'Emotes (hold)'],
    [['M'], 'Map (city only; Shift + M works too)'],
  ],
  Driving: [
    [['W', 'S'], 'Gas and brake'],
    [['A', 'D'], 'Steer'],
    [['Space'], 'Handbrake'],
    [['Shift'], 'Boost (with the gas; not bicycles)'],
    [['Z'], 'Change camera'],
    [['X'], 'Look back'],
    [['H'], 'Honk'],
    [['M'], 'Map (city only; Shift + M works too)'],
    [['R'], 'Race'],
    [['E'], 'Get out'],
  ],
  Racing: [
    [['R'], 'Join the race, or say you’re ready'],
    [['W', 'S'], 'Gas and brake'],
    [['A', 'D'], 'Steer'],
    [['Space'], 'Handbrake round the hairpins'],
    [['Backspace'], 'Reset the car at the circuit'],
    [['Shift'], 'Boost (with the gas; not bicycles)'],
    [['Z'], 'Change camera'],
    [['X'], 'Look back'],
  ],
  Arena: [
    [['W', 'A', 'S', 'D'], 'Move'],
    [['Mouse'], 'Aim'],
    [['Click'], 'Fire'],
    [['Right click'], 'Aim down the sights'],
    [['R'], 'Reload'],
    [['1', '2', 'Q'], 'Swap rifle / SMG (or the wheel)'],
    [['C'], 'Crouch (from a run: slide)'],
    [['Tab'], 'Scoreboard (hold)'],
    [['Space'], 'Jump; at a ledge, climb up'],
  ],
  Everywhere: [
    [['?'], 'Controls'],
    [['Esc'], 'Close a window'],
    [['T', 'Enter'], 'Chat'],
    [['V'], 'Join voice / hold to talk'],
    [['U'], 'Mute / unmute voice'],
  ],
};

/** Shift can be held while running or boosting; the city map mustn't take the circuit's keys. */
export function globalShortcut(e: Pick<KeyboardEvent, 'code' | 'key'>, away: boolean): 'map' | 'controls' | 'mute' | null {
  if (e.key === '?') return 'controls';
  if (e.code === 'KeyM' && !away) return 'map';
  if (e.code === 'KeyU') return 'mute';
  return null;
}
