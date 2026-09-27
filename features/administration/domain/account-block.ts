export function accountBlocked(
  profile: { suspended?: boolean; suspendedUntil?: string },
  now = Date.now(),
) {
  return Boolean(
    profile.suspended &&
    (!profile.suspendedUntil ||
      !Number.isFinite(Date.parse(profile.suspendedUntil)) ||
      Date.parse(profile.suspendedUntil) > now),
  );
}
