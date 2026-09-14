import {
  DEFAULT_RESOURCE_PROFILE,
  resourceLimitsFor,
  type ResourceProfile,
  type ResourceProfileLimits
} from '@shared/contracts/resources'

let profile: ResourceProfile = DEFAULT_RESOURCE_PROFILE

export function applyRendererResourceProfile(next: ResourceProfile): void {
  profile = next
}

export function currentRendererResourceProfile(): ResourceProfile {
  return profile
}

export function currentResourceLimits(): ResourceProfileLimits {
  return resourceLimitsFor(profile)
}
