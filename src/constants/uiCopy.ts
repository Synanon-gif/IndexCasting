/**
 * Centralized user-facing copy — English only.
 * Import from here for buttons, alerts, labels, and empty states (Agency, Client, Model).
 */
export const uiCopy = {
  common: {
    save: 'Save',
    saving: 'Saving…',
    saved: 'Saved',
    delete: 'Delete',
    cancel: 'Cancel',
    confirm: 'Confirm',
    close: 'Close',
    error: 'Error',
    success: 'Success',
    loading: 'Loading…',
    help: 'Help',
    logout: 'Logout',
    yes: 'Yes',
    no: 'No',
    reloadPage: 'Reload page',
  },
  alerts: {
    scheduleUpdated: 'The booking time was updated.',
    scheduleSaveFailed: 'Could not save the booking time.',
    calendarEntryUpdated: 'Calendar entry was updated.',
    calendarSaveFailed: 'Could not save. Check date format YYYY-MM-DD.',
    calendarNotSaved:
      'Entry was not saved. Check: (1) date YYYY-MM-DD, (2) profile email must match agency email, (3) run migration_calendar_entries_multi_slot_rls_email.sql in Supabase.',
    invitationCreated: 'Invitation created',
    invitationCreatedBody:
      'Share the invite link securely with the booker (e.g. by email). In-app email delivery will follow later.',
    invitationFailed:
      'Could not create invitation. Are you signed in as owner, and does Supabase RLS allow it?',
    invitationLink: 'Invitation link',
    showLastLink: 'Show last link',
    deleteFailed: 'Delete failed',
    tryAgain: 'Please try again.',
    signInRequired: 'Sign-in required',
    signInAsClientForCalendar:
      'Please sign in as a client — calendar entries require a valid user ID.',
    migrationRequired:
      'Could not save the entry. Run migration migration_calendar_entries_multi_slot_rls_email.sql in Supabase (e.g. remove UNIQUE model_id+date) and sign in again.',
    calendarUpdatedGeneric: 'Calendar was updated.',
    couldNotSaveCheckMigration: 'Could not save. Has the Supabase migration been applied?',
    deletePersonalEntryTitle: 'Delete entry',
    deletePersonalEntryMessage:
      'Are you sure you want to delete this personal calendar entry? This action cannot be undone.',
    deleteEntryFailed: 'Could not remove the entry.',
    invalidOwnerId:
      'Invalid owner_id: sign in with a real client or agency account (UUID). Demo mode cannot save Supabase calendar entries.',
  },
  team: {
    section: 'Team',
    members: 'Members',
    pendingInvitations: 'Pending invitations',
    noOpenInvitations: 'No open invitations.',
    inviteBooker: 'Invite booker',
    inviteSendLink: 'Send invitation (create link)',
    /** First user who completes agency signup (after admin activation) — profile email must match agency email — is the sole Organization Owner. */
    ownerRoleExplainerAgency:
      'There is exactly one Organization Owner per agency. It is always the first user who signs in with the agency email (after the account is activated). That person invites bookers; only the Owner can create invitations.',
    /** First client user who bootstraps the workspace is the sole Organization Owner. */
    ownerRoleExplainerClient:
      'There is exactly one Organization Owner per client organization. It is always the first client user who activates their workspace. That person invites employees; only the Owner can create invitations.',
    leadAgency:
      'Bookers receive an invite link and create their own account (GDPR). Only the Organization Owner (first sign-in with the agency email) can create new invitations.',
    noOrganizationYet:
      'No organization yet: sign in once as the agency owner (profile email = agency email, after admin activation) so the organization is created automatically.',
    /** Client team tab — invite intro (GDPR / owner-only invites). */
    leadClient:
      'Employees receive a secure invite link and create their own account. Only the Organization Owner can invite new members.',
    roleBooker: 'Booker',
    roleOwner: 'Owner',
    roleEmployee: 'Employee',
  },
  calendar: {
    editEntry: 'Edit entry',
    reschedule: 'Reschedule',
    rescheduleHelpAgency:
      'Updates the option, model calendar, and mirrored entries (migration migration_calendar_reschedule_sync.sql).',
    rescheduleHelpClient:
      'Date and time apply to all parties (option + calendar) once migration migration_calendar_reschedule_sync.sql is active.',
    saveSchedule: 'Save schedule',
    /** Client web: booking detail overlay — reschedule option/job */
    bookingUpdated: 'The booking was updated.',
    bookingUpdateFailed: 'Could not save the booking.',
    manualEventUpdated: 'Calendar entry was updated.',
    manualEventUpdateFailed: 'Could not save. Check date format YYYY-MM-DD.',
    deletePersonalCalendarEntry: 'Delete personal entry',
    manualBlockHelp: 'Edit or remove your personal block.',
    optionScheduleHelp:
      'Date/time for all parties (migration migration_calendar_reschedule_sync.sql + RPC model_update_option_schedule).',
  },
  invite: {
    pageTitle: 'Organization invitation',
    invalidOrExpired: 'This invitation is invalid or has expired.',
    loadFailed: 'Could not load invitation.',
    invitedToWorkAt: 'You were invited to work with',
    validUntil: 'Valid until',
    sameEmailInstructions:
      'Sign up or sign in with the same email address the invitation was sent to.',
    invalidLink: 'Invalid or expired invitation link.',
    copyLink: 'Copy invitation link',
    linkCopied: 'Link copied',
    roleBookerAgency: 'Booker (Agency)',
    roleEmployeeClient: 'Employee (Client)',
    roleMember: 'Member',
    signUpToAccept: 'Create account & accept',
    alreadyHaveAccount: 'I already have an account',
  },
  clientWeb: {
    calendarCalloutTitle: 'Saving to calendar:',
    calendarCalloutBody:
      'Sign in with an account whose profile role is Client. Without a valid login UUID, entries cannot be written to Supabase (demo mode "user-client" is not a UUID).',
    editEvent: 'Edit event',
  },
  auth: {
    inviteLine: 'Invitation: {org} · {role}',
    accountTypeFixed: 'Account type: {role} (set by invitation)',
    accountScheduledForDeletion:
      'Your account has been scheduled for deletion and is no longer accessible.',
    emailPasswordRequired: 'Email and password are required.',
    signUpDisplayNamePlaceholder: 'Display name',
    signUpCompanyNamePlaceholder: 'Company or organization name',
    loginTab: 'Login',
    signUpTab: 'Sign Up',
    createAccount: 'Create Account',
    roleLabel: 'Role',
    roleAgency: 'Agency',
    roleClient: 'Client',
    roleModel: 'Model',
    /**
     * Shown on Sign up when Client or Agency is selected (not when accepting an invite).
     * First self-service signup = org owner; invite links = team members only.
     */
    signUpOwnerHint:
      'The first signup as Client or Agency (without an invitation link) creates your organization and assigns you as the Organization Owner. People who register using an invite link you send become employees or bookers — they are not owners.',
  },
  /** Soft delete: profile stays 30 days, then purge via admin/cron; email reusable after auth user removed. */
  accountDeletion: {
    sectionTitle: 'Account',
    description:
      'You can schedule deletion of your account. Data is retained for 30 days, then permanently removed. After removal, you may register again with the same email.',
    confirmTitle: 'Delete account?',
    confirmMessage:
      'Your account will be scheduled for deletion. Data is kept for 30 days, then permanently deleted. You will be signed out and cannot sign in until the process completes. Continue?',
    button: 'Delete account',
    buttonWorking: 'Scheduling…',
    failed: 'Could not schedule account deletion. Try again or contact support.',
    ownerOnly:
      'Only the organization owner can delete this workspace account. Contact your owner if you need to leave the team.',
    notAvailableSignedOut: 'Sign in with a full account to manage deletion.',
  },
  app: {
    crashTitle: 'Something went wrong',
    crashBody:
      'A render error occurred. This is not caused by GitHub or Supabase — see the message below. On web, open the console (F12).',
    supabaseMissing:
      'Supabase is not configured.\n\nCheck .env.local:\nNEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY',
  },
  apply: {
    displayNameMissing:
      'Display name is missing in your profile. Add a name under Account and try again.',
    firstNameRequired: 'Please enter first name.',
    nameRequired: 'Please enter first and last name.',
    nameLockedHint:
      'Matches your account name (profile) and cannot be changed here. Two words = first and last name; one word = first name only.',
  },
  model: {
    agencyLabel: 'Agency',
    chatsSubtitle: 'Chats with agencies that responded to your application.',
    noAgencyMessages: 'No messages from agencies yet.',
    openChat: 'Open chat',
    applicationDefaultsSubtitle: 'Default details for your applications.',
    noApplicationsYet: 'No applications yet. Create an application first to edit defaults.',
  },
  login: {
    dummyFlow: 'Dummy flow — pick a role to open that workspace.',
  },
  /** Agency app — Settings tab (organization owner only). */
  agencySettings: {
    tabLabel: 'Settings',
    screenTitle: 'Agency settings',
    intro: 'Update how clients see your agency in Discover and Agencies.',
    sectionGeneral: 'General',
    sectionContact: 'Contact',
    sectionAddress: 'Address',
    sectionSegments: 'Agency type',
    segmentsHint: 'Select all that apply. Used for client filtering.',
    fieldName: 'Agency name',
    fieldDescription: 'Description',
    fieldEmail: 'Email',
    fieldPhone: 'Phone',
    fieldWebsite: 'Website',
    fieldStreet: 'Street',
    fieldCity: 'City',
    fieldCountry: 'Country',
    save: 'Save settings',
    saveFailed: 'Could not save settings. If you are the organization owner, run the latest Supabase migration for agency settings.',
    saveSuccess: 'Settings saved.',
    bookerNoAccess: 'Only the organization owner can edit agency settings.',
  },
  /** Agency — My Models manual editor (portfolio + polaroids). */
  modelRoster: {
    visibleInClientSwipe: 'Visible in client swipe',
    portfolioTitle: 'Portfolio images',
    portfolioHint: 'First image is the cover for client swipe. Reorder with arrows or tap Cover.',
    polaroidsTitle: 'Polaroids',
    polaroidsHint: 'Separate from portfolio. Only images marked visible appear in client swipe.',
    territoriesTitle: 'Territories of Representation',
    territoriesHint: 'Select the countries where this agency represents the model.',
    territoriesSearchPlaceholder: 'Search by country code or name…',
    noTerritoriesSelected: 'No territories selected.',
    pickFromLibrary: 'Pick from library',
    addPolaroidUrlPlaceholder: 'Paste polaroid image URL',
    portfolioRequiredTitle: 'Portfolio required',
    portfolioRequiredBody:
      'Enable at least one portfolio image with visible client swipe so clients can see this model.',
  },
  /** B2B org-to-org chats (no social graph). */
  b2bChat: {
    /** Agency app — Messages: intro + B2B tab = chats with client orgs */
    messagesIntroAgency: 'Option requests, client chats, and recruiting — all in one place.',
    /** Client web — Messages: optional intro copy */
    messagesIntroClient: 'Option requests and agency chats — all in one place.',
    tabOptionRequests: 'Option requests',
    tabRecruiting: 'Recruiting chats',
    /** Agency Messages: B2B pill + section (you message clients). */
    tabB2BChatsAgencyView: 'Client chats',
    /** Client Messages: B2B pill (you message agencies). */
    tabB2BChatsClientView: 'Agency chats',
    clientsSectionTitle: 'Clients',
    clientsSectionSubtitle: 'Search client organizations (not individuals). Start an organization-to-organization chat.',
    clientsSearchPlaceholder: 'Search by client organization name…',
    clientsEmpty: 'No client organizations match your search.',
    noAgencyContext: 'No agency context — cannot load chats.',
    /** Agency: empty B2B list */
    noClientChatsYetAgency: 'No client chats yet. Start a chat from the Clients tab.',
    /** Client: empty B2B list */
    noAgencyChatsYetClient: 'No agency chats yet. Start a chat from the Agencies tab.',
    /** Client B2B panel: org could not be resolved */
    noClientWorkspaceForB2B:
      'Could not load your client workspace. Sign in with a client account or accept a team invitation.',
    clientWorkspaceLoading: 'Loading workspace…',
    /** Last resort when org name cannot be resolved (network/RPC missing); never use as primary label */
    chatPartnerFallback: 'Chat partner',
    agencyFallback: 'Agency',
    clientFallback: 'Client',
    openConversation: 'Open chat',
    messagePlaceholder: 'Message…',
    send: 'Send',
    sharePackage: 'Share package',
    shareModel: 'Share model',
    sharedPackage: 'Package',
    sharedPackageBody: 'Shared a model package',
    sharedModel: 'Model',
    sharedModelBodyPrefix: 'Shared model:',
    modelsCount: 'models',
    openPackage: 'Open package',
    modelIdLabel: 'Model ID',
    pickPackage: 'Choose a package to share',
    pickModel: 'Choose a model to share',
    /** Client web — Agencies tab */
    agenciesSectionTitle: 'Agencies',
    agenciesSubtitle: 'Search agencies and start a business chat',
    agenciesSearchPlaceholder: 'Search by name, city, focus…',
    agencyTypeFilterLabel: 'Filter by agency type',
    agencyNotFoundTitle: 'Agency could not be found. Send invitation link?',
    agencyEmailPlaceholder: 'Agency email address',
    sendInvitation: 'Send invitation',
    startChat: 'Start chat',
    openChat: 'Open chat',
    chatReady: 'Chat is open — you can message now.',
    signInToChatBody: 'Please sign in as a client to start a chat.',
    signInToChatGeneric: 'Please sign in to start a chat.',
    chatFailedTitle: 'Could not open chat',
    chatFailedGeneric: 'Could not create or load the chat. Check your network and try again.',
    /** PostgREST: RPC missing in Supabase project */
    migrationRequiredResolveRpc:
      'Database function missing: run migration_resolve_b2b_chat_organization_ids.sql in the Supabase SQL Editor, then try again.',
    /** PostgREST: create chat RPC missing */
    migrationRequiredCreateB2bRpc:
      'Database function missing: run migration_rpc_create_b2b_org_conversation.sql in the Supabase SQL Editor, then try again.',
    migrationRequiredB2bOrgDirectory:
      'Database functions missing: run migration_b2b_org_directory_and_pair_resolve.sql in the Supabase SQL Editor, then try again.',
    /** ensureClientAgencyChat — agency org row missing after lookup + bootstrap */
    ensureAgencyOrgMissing:
      'Agency workspace is not linked yet. The Organization Owner — the first user who signs in with the agency email after activation — must sign in once so the organization exists; then all team members can start chats.',
    /** Signed-in client could not get/create a client org */
    ensureClientOrgSelfFailed:
      'Could not set up your client workspace. Your profile must use role “Client”. Complete signup or contact support.',
    /** Agency starts chat with a client user who has no client org */
    ensureClientTargetNeedsOrg:
      'This client has no workspace yet. They must sign in as a client (or accept a team invitation) so their organization exists before you can chat.',
    contactLink: 'Contact',
  },
  adminDashboard: {
    deletePermanentlyTitle: 'Delete account permanently',
    deletePermanentlyMessage:
      'This will delete all profile data in the database for this user. You may also need to remove the Auth user in Supabase Dashboard → Authentication → Users so they cannot sign in again. Continue?',
    deleteData: 'Delete data',
    purgeSuccess:
      'Profile data deleted. Remove the user in Supabase Authentication if they should not be able to sign in again.',
    purgeFailed: 'Purge failed.',
    purgeFailedWithDetails: 'Purge failed: {details}',
    /** profiles.role — model / agent / client only */
    accountRoleHint:
      'Account type (Role): use model, agent, or client — this is the login/account kind. It is not the B2B Owner/Booker role.',
    organizationRolesTitle: 'Organization roles (B2B)',
    organizationRolesHint:
      'Owner, Booker (agency), or Employee (client) apply per workspace. Promoting someone to Owner moves the previous owner to Booker or Employee.',
    orgRoleSetOwner: 'Set as Owner',
    orgRoleSetBooker: 'Set as Booker',
    orgRoleSetEmployee: 'Set as Employee',
    orgRoleUpdated: 'Organization role updated.',
    orgRoleFailed: 'Could not update organization role. Check console and migrations.',
    orgRoleNoneLoaded: 'No organization memberships found for this user.',
    /** Shown where the old “Admin: Yes/No” toggle was removed */
    adminFlagNotEditableInApp:
      'Platform admin access cannot be granted from this screen. It is set only in the database.',
  },
} as const;

export type UiCopyKey = typeof uiCopy;
