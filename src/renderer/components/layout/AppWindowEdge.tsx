export function AppWindowEdge(): React.JSX.Element {
  return (
    <div className="app-window-edge" aria-hidden>
      <div className="app-window-edge-track app-window-edge-track-soft">
        <span className="app-window-edge-spin app-window-edge-spin-soft" />
      </div>
      <div className="app-window-edge-track">
        <span className="app-window-edge-spin" />
      </div>
    </div>
  )
}
