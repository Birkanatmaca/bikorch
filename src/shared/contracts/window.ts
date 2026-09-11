export interface WindowChromeState {
  maximized: boolean
  fullScreen: boolean
}

export const WINDOW_IPC = {
  MINIMIZE: 'window:minimize',
  MAXIMIZE: 'window:maximize',
  CLOSE: 'window:close',
  IS_MAXIMIZED: 'window:isMaximized',
  IS_FULL_SCREEN: 'window:isFullScreen',
  GET_STATE: 'window:getState',
  STATE_CHANGED: 'window:state-changed',
  DRAG_START: 'window:drag-start',
  DRAG_MOVE: 'window:drag-move',
  DRAG_END: 'window:drag-end'
} as const
