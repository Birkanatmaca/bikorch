/** YouTube iframe is no longer used for playback; audio always goes through HTMLAudioElement. */
export function StreamingPlayerPanel(): React.JSX.Element {
  return <div className="hidden" aria-hidden />
}
