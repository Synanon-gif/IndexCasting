export type InviteDeliveryState =
  | 'sent'
  | 'already_invited'
  | 'already_member'
  | 'token_created_mail_failed'
  | 'fatal';

export function describeSendInviteFailure(payload: unknown, invokeError: unknown): string {
  const o = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const code = typeof o.error === 'string' ? o.error : '';
  const detail = typeof o.detail === 'string' ? o.detail : '';
  switch (code) {
    case 'email_service_not_configured':
      return 'Email service is not configured for this project (missing provider key).';
    case 'not_member_of_organization':
      return 'You are not a member of the selected organization.';
    case 'agency_only':
      return 'Only agency team members can send model claim emails.';
    case 'owner_only':
      return 'Only the organization owner can send this invitation.';
    case 'invitation_not_found':
      return 'The invitation token could not be found.';
    case 'invitation_not_pending':
      return 'This invitation is no longer pending.';
    case 'invitation_role_invalid':
      return 'The invitation role is invalid.';
    case 'invitation_email_mismatch':
      return 'The invite email does not match the stored invitation.';
    case 'invitation_role_mismatch':
      return 'The invite role does not match the stored invitation.';
    case 'invitation_org_mismatch':
      return 'The selected organization does not match the stored invitation.';
    case 'invitation_context_unavailable':
      return 'Invitation context could not be verified right now.';
    case 'email_send_failed':
      return detail ? `Email provider error: ${detail.slice(0, 200)}` : 'Email provider rejected the message.';
    case 'email_send_exception':
      return 'Email could not be sent (network or server error).';
    default:
      break;
  }
  if (invokeError && typeof invokeError === 'object' && invokeError !== null && 'message' in invokeError) {
    return String((invokeError as { message?: string }).message ?? 'Invoke failed');
  }
  if (code) return code;
  return 'Unknown error';
}
