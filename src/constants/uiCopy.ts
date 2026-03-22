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
    leadAgency:
      'Bookers receive an invite link and create their own account (GDPR). Only the agency email (owner) can create new invitations.',
    noOrganizationYet:
      'No organization yet: sign in as agency master (profile email = agency email); the organization is created automatically.',
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
  /** B2B org-to-org chats (no social graph). */
  b2bChat: {
    messagesIntro: 'Option requests, agency chats, and recruiting — all in one place.',
    tabOptionRequests: 'Option requests',
    tabRecruiting: 'Recruiting chats',
    tabClientChats: 'Agency chats',
    tabRecruitingChats: 'Recruiting chats',
    recruitingChatsEmpty:
      'Recruiting chats with agencies will appear here when this feature is enabled for your account.',
    clientsSectionTitle: 'Clients',
    clientsSectionSubtitle: 'Search client organizations and start a chat.',
    clientsSearchPlaceholder: 'Search by name, email, or company…',
    clientsEmpty: 'No clients match your search.',
    noAgencyContext: 'No agency context — cannot load chats.',
    noChatsYet: 'No agency chats yet. Start a chat from the Agencies tab.',
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
    contactLink: 'Contact',
  },
} as const;

export type UiCopyKey = typeof uiCopy;
