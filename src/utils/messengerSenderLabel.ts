/** English label for connection chat bubbles: "Name (Role)". */
export function formatSenderDisplayLine(
  displayName: string,
  orgRoleLabel: string | null,
  profileRole: string | null
): string {
  const fromProfile =
    profileRole === 'agent'
      ? 'Agency'
      : profileRole === 'client'
        ? 'Client'
        : profileRole === 'model'
          ? 'Model'
          : null;
  const role = orgRoleLabel ?? fromProfile;
  if (!role) return displayName;
  return `${displayName} (${role})`;
}
