import type { HarnessProfile } from './protocol';

export function nextHarnessProfile(profile: HarnessProfile): HarnessProfile {
  return profile === 'small-model' ? 'standard' : 'small-model';
}
