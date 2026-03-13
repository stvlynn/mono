export function shouldSetConnectedProfileAsDefault(hasAnyConfiguredProfiles: boolean): boolean {
  return !hasAnyConfiguredProfiles;
}
