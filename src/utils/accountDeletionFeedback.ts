import { uiCopy } from '../constants/uiCopy';

/**
 * Maps dissolve_organization / PostgREST errors to safe English user copy.
 * Never forwards raw SQL or internal exception text.
 */
export function messageForDissolveOrganizationError(error?: string): string {
  const e = (error ?? '').trim();
  if (!e) return uiCopy.accountDeletion.dissolveOrgFailed;

  const lower = e.toLowerCase();
  if (lower.includes('forbidden_not_owner')) {
    return uiCopy.accountDeletion.dissolveOrgNotOwner;
  }
  if (lower.includes('not_authenticated')) {
    return uiCopy.accountDeletion.dissolveNotSignedIn;
  }
  if (
    lower.includes('foreign key') ||
    lower.includes('23503') ||
    lower.includes('violates foreign key')
  ) {
    return uiCopy.accountDeletion.dissolveOrgFailedDependencies;
  }
  return uiCopy.accountDeletion.dissolveOrgFailed;
}
