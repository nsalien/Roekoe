/**
 * A safety net around the live map.
 *
 * The map is the only part of the game that hands a DOM node to a non-React
 * library (Leaflet) and then lets it write into it. React has no error boundary
 * by default, so anything that throws in there — a bad coordinate, a failed lazy
 * chunk, a Leaflet internal — unmounts the WHOLE page, not just the map. A player
 * then sees the board vanish with no way back except a reload.
 *
 * This turns that into a message and a button. Deliberately outside the lazy
 * chunk (see LiveFlightPage), so it also catches a chunk that fails to download.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { failed: boolean }

export class MapErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Left in on purpose: if this ever fires in production, the console is the
    // only place a player can tell us what actually happened.
    console.error('Live kaart is gecrasht:', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flight-map map-loading" style={{ flexDirection: 'column', gap: 8 }}>
        <span>🗺️ De kaart kon niet getoond worden.</span>
        <button className="btn ghost sm" onClick={() => this.setState({ failed: false })}>
          Opnieuw proberen
        </button>
      </div>
    );
  }
}
