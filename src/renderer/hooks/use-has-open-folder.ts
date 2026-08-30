import { useActiveProject } from '@renderer/hooks/use-active-project'

export function useHasOpenFolder(): boolean {
  const { projectRoot } = useActiveProject()
  return projectRoot !== null
}
