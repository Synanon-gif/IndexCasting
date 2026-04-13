/** Resolved two-line sender header for B2B org chat (name + org / membership). */
export type MessengerSenderDisplayInput = {
  displayName: string;
  organizationName: string | null;
  membershipLabel: string | null;
};

export function buildMessengerSenderDisplay(input: MessengerSenderDisplayInput): {
  primaryLine: string;
  secondaryLine: string | null;
} {
  const name = input.displayName?.trim() || '';
  const org = input.organizationName?.trim() || null;
  const mem = input.membershipLabel?.trim() || null;
  if (org && mem) {
    return { primaryLine: name, secondaryLine: `${org} · ${mem}` };
  }
  if (org) {
    return { primaryLine: name, secondaryLine: org };
  }
  if (mem) {
    return { primaryLine: name, secondaryLine: mem };
  }
  return { primaryLine: name, secondaryLine: null };
}

/** English label for org-scoped chat bubbles: "Name (Role)". */
export function formatSenderDisplayLine(
  displayName: string,
  orgRoleLabel: string | null,
  profileRole: string | null,
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
