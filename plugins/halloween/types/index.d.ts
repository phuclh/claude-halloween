/** Where one bat of the flock is, in cells of the region it crosses. */
export type BatSpot = { x: number; y: number }

declare module 'claude-code' {
  interface PluginState {
    halloween: {
      isEnabled: boolean
      hasSounds: boolean
      draftRows: number
      frameTick: number
      flightTick: number
      isAwake: boolean
      isSelecting: boolean
    }
  }
}
