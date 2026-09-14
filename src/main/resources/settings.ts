import {
  DEFAULT_RESOURCE_PROFILE,
  parseResourceProfile,
  resourceLimitsFor,
  type ResourceProfile,
  type ResourceProfileLimits
} from '@shared/contracts/resources'
import { readMetaValue, writeMetaValue } from '../persistence/database'
import { setIsolationMemoryLimit } from '../git/agent-run-store'

const META_KEY = 'resource_profile'

let profile: ResourceProfile = DEFAULT_RESOURCE_PROFILE

export function getResourceProfile(): ResourceProfile {
  return profile
}

export function getResourceLimits(): ResourceProfileLimits {
  return resourceLimitsFor(profile)
}

export function loadResourceProfile(): ResourceProfile {
  try {
    profile = parseResourceProfile(readMetaValue(META_KEY))
  } catch {
    profile = DEFAULT_RESOURCE_PROFILE
  }
  setIsolationMemoryLimit(resourceLimitsFor(profile).isolationMemoryRepos)
  return profile
}

export function setResourceProfile(next: ResourceProfile): ResourceProfile {
  profile = next
  setIsolationMemoryLimit(resourceLimitsFor(profile).isolationMemoryRepos)
  try {
    writeMetaValue(META_KEY, next)
  } catch {
    // Persistence may be unavailable in tests / fallback mode.
  }
  return profile
}
