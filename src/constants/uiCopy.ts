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
    edit: 'Edit',
    change: 'Change',
    refresh: 'Refresh',
    cancel: 'Cancel',
    confirm: 'Confirm',
    close: 'Close',
    error: 'Error',
    success: 'Success',
    loading: 'Loading…',
    /** Minimal busy indicator (single glyph) for inline buttons. */
    busyEllipsis: '…',
    help: 'Help',
    logout: 'Logout',
    yes: 'Yes',
    no: 'No',
    reloadPage: 'Reload page',
    retry: 'Retry',
    remove: 'Remove',
    noAgencyContext:
      'Your account is not linked to an agency yet. Please contact your administrator.',
    /**
     * Last-resort fallback when an agency name cannot be resolved at all.
     * Per organization-identity invariants we never render a generic "Agency" placeholder.
     */
    unknownAgency: 'Unknown agency',
    /** Last-resort fallback for client organization label. */
    unknownClient: 'Unknown client',
    /** Last-resort fallback for model display name. */
    unknownModel: 'Unknown model',
  },
  /** Unauthenticated ?shared=1 selection link (SharedSelectionView). */
  sharedSelection: {
    title: 'Shared selection',
    empty: 'No models in this selection.',
    loadFailed: 'Failed to load models. Please try again later.',
    signUpToAccess: 'Sign up to get full access',
    authGateBody:
      'Create an account to chat with agencies, request options, and manage your selections.',
    authGateSignUp: 'Sign up',
    authGateContinue: 'Continue browsing',
    backToGallery: '← Back to gallery',
    footerCta: 'Sign up for full access',
    visitSite: 'Visit IndexCasting',
    continueToWorkspace: 'Open in your workspace',
    alreadySignedIn: "You're signed in",
    alreadySignedInBody:
      'Open this selection in your workspace to chat with agencies, request options, and add models to your projects.',
  },
  /** GDPR Art. 20 / 7 — agency settings tab + client web settings (English-only). */
  privacyData: {
    sectionTitle: 'Privacy & your data (GDPR)',
    art20Body:
      'Under GDPR Art. 20 you have the right to receive a copy of your personal data in a portable format.',
    downloadMyData: 'Download my data',
    preparingExport: 'Preparing export…',
    art7Body:
      'Under GDPR Art. 7, you may withdraw your consent to optional data processing (marketing, analytics) at any time. This does not affect the lawfulness of processing already carried out.',
    withdrawOptionalConsent: 'Withdraw optional consent',
    withdrawingConsent: 'Withdrawing…',
    withdrawConfirmWeb:
      'Withdraw optional marketing & analytics consent? This does not affect core platform functionality.',
    withdrawConfirmClientWeb:
      'Withdraw marketing & analytics consent? This does not delete your account or affect core platform functionality.',
    consentWithdrawnTitle: 'Consent withdrawn',
    consentWithdrawnBody:
      'Your optional consent has been withdrawn. It may take up to 24 hours to take full effect.',
    downloadStartedTitle: 'Download started',
    downloadStartedBody: 'Your data export has been downloaded as a JSON file.',
    exportNativeTitle: 'Data export',
    exportNativeBody:
      'Your personal data export was prepared. Please use the web version of IndexCasting to download your data as a file.',
    couldNotExport: 'Could not export your data. Please try again later.',
    exportErrorGeneric:
      'We could not complete your data export. Please try again in a few minutes or contact support if this keeps happening.',
    exportErrorPermission:
      'You do not have permission to export this data. Sign in with the correct account and try again.',
    exportErrorSession: 'Your session expired. Sign in again, then retry the export.',
    exportErrorServerSchema:
      'The export service is temporarily unavailable. Please try again later — our team has been notified.',
    calendarSectionTitle: 'Calendar sync (iCal)',
    calendarSectionBody:
      'Download your appointments as an .ics file or subscribe with a private link in Google Calendar, Apple Calendar, or Outlook.',
    /** Art. 15 transparency: ICS/feed ⊂ full JSON export (excludes e.g. booking_events in sync). */
    calendarSyncVsFullExportNotice:
      'Calendar file and subscription link include the same merged subset as in-app calendar (not every table in your data export). For your complete portable copy under GDPR, use “Download my data” (JSON), which also includes booking_events.',
    downloadCalendarIcs: 'Download calendar (.ics)',
    rotateCalendarFeed: 'Create subscription link',
    calendarFeedCreatedTitle: 'Subscription link',
    calendarFeedCreatedBody:
      'Copy the HTTPS or webcal URL below into your calendar app (Subscribe / From URL). Anyone with this link can see your synced appointments — store it like a password.',
    calendarFeedRotateFailed: 'Could not create a subscription link. Please try again.',
    calendarDownloadFailed: 'Could not build your calendar file. Please try again.',
    calendarIcsWebOnlyTitle: 'Download on web',
    calendarIcsWebOnlyBody:
      'Downloading a calendar file (.ics) is available in the web app. Open IndexCasting in your browser, go to Privacy & your data, and use Download calendar (.ics). Subscription links work in the mobile app.',
    calendarDownloadStartedTitle: 'Calendar downloaded',
    calendarDownloadStartedBody: 'Your calendar file (.ics) has been saved.',
    calendarRevokeFeed: 'Disable subscription link',
    calendarRevokeFeedConfirm:
      'Disable the calendar subscription link? Subscribed calendars will stop updating.',
    calendarRevokeDone: 'Subscription link disabled.',
    calendarRevokeFailed: 'Could not disable the link. Please try again.',
    couldNotWithdrawConsent: 'Could not withdraw consent. Please try again later.',
  },
  alerts: {
    scheduleUpdated: 'The booking time was updated.',
    scheduleSaveFailed: 'Could not save the booking time.',
    calendarEntryUpdated: 'Calendar entry was updated.',
    calendarSaveFailed: 'Could not save. Check date format YYYY-MM-DD.',
    calendarNotSaved:
      'Entry was not saved. Check: (1) date format YYYY-MM-DD, (2) your profile email must match the agency email.',
    deleteEventConfirm: 'Delete this event? This action cannot be undone.',
    invitationCreated: 'Invitation sent',
    invitationCreatedBody: 'An invitation email has been sent.',
    invitationEmailFailed:
      'Invitation created, but the email could not be sent. Copy the link below and share it manually.',
    invitationFailed:
      'Could not create invitation. Make sure you are signed in as the organization owner.',
    invitationAlreadyInvited: 'An active invitation for this email already exists.',
    invitationAlreadyMember: 'This person is already a member of this organization.',
    invitationOwnerOnly: 'Only the organization owner can send invitations.',
    invitationLink: 'Invitation link',
    showLastLink: 'Show link (fallback)',
    deleteFailed: 'Delete failed',
    tryAgain: 'Please try again.',
    signInRequired: 'Sign-in required',
    signInAsClientForCalendar:
      'Please sign in as a client — calendar entries require a valid user ID.',
    migrationRequired:
      'Could not save the entry. Please sign in again or contact support if this issue persists.',
    calendarUpdatedGeneric: 'Calendar was updated.',
    couldNotSaveCheckMigration: 'Could not save. Please try again or contact support.',
    deletePersonalEntryTitle: 'Delete entry',
    deletePersonalEntryMessage:
      'Are you sure you want to delete this personal calendar entry? This action cannot be undone.',
    deleteEntryFailed: 'Could not remove the entry.',
    invalidOwnerId:
      'Invalid owner_id: sign in with a valid client or agency account to save calendar entries.',
    noTerritoryForCountry:
      'No agency territory found for this model and country. Booking cannot be created.',
    missingCountryCode:
      'Country is missing. Booking cannot be routed without a selected territory country.',
    /** addOptionRequest: no Supabase session (guest / signed-out client surface). */
    optionRequestRequiresSignIn:
      'Sign in to submit an option or casting request. Nothing was sent.',
    invalidDateTitle: 'Invalid date',
    invalidDateBody: 'Please enter a valid date (YYYY-MM-DD).',
    invalidTimeTitle: 'Invalid time',
    invalidTimeBody: 'Please use HH:MM format for times.',
    someRequestsNotCreated: 'Some requests could not be created.',
    couldNotAddModel: 'Could not add model',
    emailRequiredTitle: 'Email required',
    emailRequiredForLinkBody: 'Enter the email the model used to register.',
    linkedTitle: 'Linked',
    linkedBody: 'The model account is now connected to this profile.',
    couldNotLinkTitle: 'Could not link',
    endRepresentationTitle: 'End representation',
    endRepresentationBody:
      'Remove this model from your roster? The model will be unlinked from your agency.',
    endRepresentationConfirm: 'End',
    endRepresentationButton: 'End representation (soft-remove)',
    endRepresentationFailedTitle: 'Could not end representation',
    endRepresentationFailedBody:
      'The model was not removed from your roster. Try again or contact support if this persists.',
    endRepresentationSuccessTitle: 'Model removed from agency',
    endRepresentationSuccessBody: 'Your roster has been updated.',
    removeModelMissingOrgTitle: 'Cannot remove model',
    removeModelMissingOrgBody:
      'Organization context is missing. Reload the app and try again, or contact support.',
    locationUpdatedTitle: 'Location Updated',
    locationErrorTitle: 'Location Error',
    locationErrorFallback: 'Could not retrieve your location.',
    missingFieldsTitle: 'Missing fields',
    missingFieldsLocationBody: 'Please enter both a city and country code (e.g. DE, FR, US).',
    cityNotFoundTitle: 'City not found',
    locationSetTitle: 'Location set',
    cannotRemoveTitle: 'Cannot remove',
    cannotRemoveAgencyBody: 'This location was set by your agency. Contact them to change it.',
    removeLocationConfirmBody: 'Your location will no longer appear in the Near Me filter.',
    couldNotRemoveLocation: 'Could not remove location. Please try again.',
    couldNotSaveLocation: 'Could not save your location. Please try again.',
    /** Model: live GPS location was set successfully — accepts the resolved city name. */
    liveGpsLocationSet: (cityName: string) => `Live GPS location set to: ${cityName}`,
    /** Model: confirm-availability RPC failed (status changed or agency not yet confirmed). */
    couldNotConfirmAvailability:
      'Could not confirm availability. The agency may not have confirmed yet, or the request status has changed. Please try again later.',
    /** Model: decline-availability RPC failed. */
    couldNotDeclineRequest: 'Could not decline the request. Please try again later.',
    /** Model: calendar entry insert/update failed (title for short alert). */
    calendarTitle: 'Calendar',
  },
  team: {
    section: 'Team',
    members: 'Members',
    teamMembers: 'Team members',
    pendingInvitations: 'Pending invitations',
    acceptedInvitations: 'Accepted invitations',
    noOpenInvitations: 'No open invitations.',
    noMembersLoaded: 'No members loaded.',
    noPendingInvitations: 'None.',
    noAcceptedInvitations: 'None yet.',
    invitationsHiddenForMember: 'Visible to organization owners and employees only.',
    inviteExpiresLabel: 'Expires',
    inviteAcceptedLabel: 'Accepted',
    inviteSection: 'Invite member',
    inviteEmailLabel: 'Email',
    inviteEmailPlaceholder: 'name@company.com',
    inviteRoleLabel: 'Role',
    inviteRoleEmployee: 'Employee',
    sendInvitation: 'Send invitation',
    ownerOnlyInviteNote: 'Only the organization owner can send invitations.',
    orgNotLoaded: 'Organization could not be loaded. Ensure your profile is a client account.',
    noClientSignIn: 'Sign in with a client account to manage your organization team.',
    loadingTeam: 'Loading team…',
    loadTeamError: 'Could not load team data. Please try again.',
    permissionAlertTitle: 'Permission',
    permissionAlertOwnerOnly: 'Only the organization owner can send invitations.',
    invitationCreatedWithLink: (link: string) =>
      `Share this link securely with the invitee (e.g. by email):\n\n${link}`,
    invitationErrorBody:
      'Could not create invitation. Ensure you are signed in as the organization owner.',
    inviteBooker: 'Invite booker',
    inviteSendLink: 'Send invitation (create link)',
    teamSeatsUsage: (used: number, max: number) =>
      `Team seats: ${used} of ${max} on your current plan (owner + bookers).`,
    teamSeatsUnlimited: 'Team seats: unlimited on your current plan.',
    agencyPlanMemberLimitReached:
      'Plan limit reached. Open Billing to upgrade and add another booker.',
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
    ownerDisplayNameLabel: 'Your name',
    ownerDisplayNamePlaceholder: 'Enter your display name',
    ownerDisplayNameSave: 'Save name',
    ownerDisplayNameSaved: 'Name saved.',
    ownerDisplayNameHint: 'Your name is visible to all members of your organization.',
    ownerDisplayNameError: 'Could not save name. Please try again.',
  },
  inviteDelivery: {
    invitationCreatedWithManualLink: (link: string) =>
      `Invitation created. If email delivery fails, share this secure link manually:\n\n${link}`,
    invitationCreatedEmailFailedWithLink: (reason: string, link: string) =>
      `Invitation created, but email delivery failed (${reason}). Share this secure link manually:\n\n${link}`,
  },
  inviteResend: {
    cta: 'Resend invite',
    success: 'Invite sent again',
    loading: 'Sending invite...',
    error: 'Could not resend invite',
    checkSpamHint: 'Please ask the recipient to check spam or junk folders.',
  },
  calendar: {
    editEntry: 'Edit entry',
    reschedule: 'Reschedule',
    rescheduleHelpAgency:
      'Updates the option, model calendar, and all mirrored entries for all parties.',
    rescheduleHelpClient: 'Date and time apply to all parties (option + calendar) once saved.',
    saveSchedule: 'Save schedule',
    /** Client web: booking detail overlay — reschedule option/job */
    bookingUpdated: 'The booking was updated.',
    bookingUpdateFailed: 'Could not save the booking.',
    manualEventUpdated: 'Calendar entry was updated.',
    manualEventUpdateFailed: 'Could not save. Check date format YYYY-MM-DD.',
    deletePersonalCalendarEntry: 'Delete personal entry',
    manualBlockHelp: 'Edit or remove your personal block.',
    optionScheduleHelp: 'Date and time are applied for all parties once saved.',
    bookingEvent: 'Booking event',
    date: 'Date',
    status: 'Status',
    sharedNotesTitle: 'Shared notes',
    sharedNotesHelpAgency: 'Visible to client and model. Minimise personal data (GDPR).',
    sharedNotesHelpClient: 'Visible to agency and model. Minimise personal data (GDPR).',
    sharedNotesHelpModel:
      'Visible to client, agency, and model. English only in production workflows. Do not add unnecessary personal data (data minimisation).',
    sharedNotePlaceholder: 'Add a note for everyone on this booking…',
    postSharedNote: 'Post shared note',
    postingSharedNote: 'Posting…',
    agencyNotesTitle: 'Agency notes (internal)',
    agencyNotesPlaceholder: 'Notes only your agency sees here — not shown to client or model.',
    clientNotesTitle: 'Client notes (internal)',
    clientNotesPlaceholder:
      'Notes only your client organization sees here — not shown to agency or model.',
    modelNotesTitle: 'My notes (private)',
    modelNotesPlaceholder: 'Notes only you see here — not shown to client or agency.',
    saveNotes: 'Save notes',
    savingNotes: 'Saving…',
    bookingDetailsTitle: 'Booking details',
    /** Primary action — jump from calendar overlay to canonical option/casting thread (Messages). */
    openNegotiationThread: 'Open negotiation',
    /** Calendar detail — one-line next step from Smart Attention (role-filtered in UI). */
    nextStepLabel: 'Next step',
    nextStepAwaitingModel: 'Waiting for the model to confirm.',
    nextStepAwaitingAgency: 'Waiting for the agency.',
    nextStepAwaitingClient: 'Waiting for your organization.',
    nextStepJobConfirm: 'Confirm this job when ready.',
    nextStepNegotiating: 'Negotiation in progress.',
    nextStepNoAction: 'No action required from you right now.',
    nextStepYourConfirm: 'Confirm or decline in the request thread.',
    /** Booking calendar row without link to option_requests — read-only detail. */
    bookingEntryDetailFallback: 'This calendar entry is not linked to a request thread.',
    /** Valid option_requests id could not be resolved — do not navigate to an arbitrary thread. */
    threadNavigationUnavailable:
      'Could not open the request thread. Try refreshing the calendar. If this persists, contact support.',
    /** Accessibility label for client calendar row attention dot */
    actionRequiredA11y: 'Action required',
    /** B2B calendar — entry type filter (client parity with agency). */
    typeFilterHeading: 'Entry type',
    typeFilterAll: 'All',
    typeFilterOption: 'Option',
    typeFilterCasting: 'Casting',
    typeFilterBooking: 'Job',
    /** Color legend shown beneath every calendar (Agency, Client Web, Model). */
    colorLegendHeading: 'Color legend',
    legendOption: 'Option',
    legendCasting: 'Casting',
    legendJob: 'Job',
    legendOwnEvent: 'Own event',
    /** Same dot color as Option — tentative job before confirmation. */
    legendTentativeJobNote: 'Tentative job uses the Option color.',
    legendAwaitingModel: 'Awaiting model',
    legendJobConfirmationPending: 'Job confirmation',
    legendRejectedOrInactive: 'Rejected / inactive',
    /** Model calendar — booking detail line for the client organization (not a generic “Client” placeholder). */
    modelEntryClientOrgLabel: 'Client organization',
    /** Multi-view calendar (Agency / Client web / Model). */
    dayViewLabel: 'Day',
    /** Visible heading above Month / Week / Day controls. */
    viewModeHeading: 'Calendar view',
    /** Shown under the view switch when Month is selected. */
    viewModeHintMonth:
      'Month shows the full grid. Tap a day to open that week; switch to Day for hourly detail.',
    /** Narrow screens: month view is a scrollable agenda list instead of a dot grid. */
    viewModeHintMonthAgenda: 'Scroll the list for this month. Use Week or Day for hourly detail.',
    agendaEmptyMonth: 'No entries in this month.',
    /** Shown under “Day:” on mobile when the scrollable agenda already lists that day’s entries. */
    agendaDayHint: 'Entries for this day are listed in the month agenda above.',
    viewModeHintWeek:
      'Week shows seven days with timed entries. Tap a day for the day view, or tap an event to open it.',
    viewModeHintDay:
      'Day shows the timeline for the selected day. If many events overlap, use “more” below the grid to open the rest.',
    /** Dense month cell — appended when opening week from month (B2B). */
    monthDenseA11yOpensWeek: 'Opens week view.',
    /** Week grid — time-of-day group labels (visual only). */
    timeBandEarly: 'Early',
    timeBandMorning: 'Morning',
    timeBandAfternoon: 'Afternoon',
    timeBandEvening: 'Evening',
    /** Week/month overview footers — count labels by bucket. */
    overviewKindJob: 'Jobs',
    overviewKindCasting: 'Castings',
    overviewKindOption: 'Options',
    overviewKindPersonal: 'Personal',
    overviewKindOther: 'Other',
    weekFooterA11yPrefix: 'Event types this day:',
    weekFooterA11ySuffix: 'Dot colors match the legend; text shows counts per type.',
    /** Day timeline — events hidden behind parallel lane cap. */
    dayTimelineOverflowShow: (n: number) => `+${n} more overlapping — tap for list`,
    dayTimelineOverflowHide: (n: number) => `Hide ${n} extra…`,
    dayTimelineOverflowA11yHint: 'Lists events that do not fit in the parallel columns above.',
    dayTimelineOverflowA11yShow: (n: number) =>
      `${n} overlapping events are not shown in the time grid. Open list to select one.`,
    dayTimelineOverflowA11yHide: (n: number) =>
      `Hide list of ${n} overlapping events not shown in the grid`,
    dayTimelineOverflowRowA11y: (start: string, end: string, title: string) =>
      `${start} to ${end}, ${title}`,
    /** Prefix before a YYYY-MM-DD in the selected-day panel. */
    selectedDayPrefix: 'Day:',
    /** No events on the picked day (quick list). */
    noEntriesThisDay: 'No entries on this day.',
    /** Agency — “Add event” opens this menu first; then the detailed form (models, date, …). */
    agencyAddEventMenuTitle: 'Add to calendar',
    agencyAddEventMenuSubtitle:
      'Create an option or casting with models from your roster, or add a private agency-only block.',
    addOptionEvent: 'Add option',
    addCastingEvent: 'Add casting',
    addPrivateCalendarEvent: 'Private event',
    /** Shown above quick-add chips on agency calendar (mobile + desktop). */
    agencyQuickAddHint: 'Create',
    /** Primary control in the calendar header — opens the add menu. */
    addEventOpenMenu: '+ Add event',
    /** Form section — event category (same choices as the add menu). */
    agencyEventTypeLabel: 'Event type',
    /** Short label for private block (distinct from “Private event” in the add menu). */
    agencyEventTypePrivateShort: 'Private',
    agencySelectModelsLabel: 'Select models',
    /** Placeholder for roster search in agency “Add option/casting” calendar form. */
    agencySearchModelsPlaceholder: 'Search models by name',
    /** Shown until the user types enough characters — avoids rendering the full roster. */
    agencySearchModelsHintTypeToSearch:
      'Type at least 2 characters to search models you represent. Selected models appear below.',
    /** When the query is one character only. */
    agencySearchModelsHintMinChars: 'Enter one more character to search.',
    agencySearchModelsNoMatches: 'No models match your search.',
    agencyModelsSelected: (n: number) => `${n} model${n === 1 ? '' : 's'} selected`,
    agencyAddingEvent: 'Adding…',
    agencyAddEventFormTitle: 'Add event',
    agencyAddEventSubmit: 'Add',
    eventTitlePlaceholder: 'Title',
    datePlaceholder: 'YYYY-MM-DD',
    dateExamplePlaceholder: '2025-03-15',
    /** Month/list badges — calendar projection (existing DB fields only). */
    projectionBadge: {
      rejected: 'Rejected',
      job: 'Job',
      jobTentative: 'Job (tentative)',
      casting: 'Casting',
      optionConfirmed: 'Option (confirmed)',
      optionNegotiating: 'Option (negotiating)',
      pricePending: 'Price (pending)',
      priceAgreed: 'Price agreed',
      optionPending: 'Option (pending)',
      /** Linked model must still confirm (aligned with Smart Attention waiting_for_model). */
      awaitingModel: 'Awaiting model',
      /** Client must confirm job (approval phase; not raw price state). */
      awaitingClientJob: 'Job (client confirm)',
      /** Agency-only flow: agency must confirm job (no client party). */
      awaitingAgencyJob: 'Job (agency confirm)',
      /** Model-facing grid/list — same state, different copy. */
      yourConfirmationNeeded: 'Your confirmation needed',
    },
  },
  /** Structured production fields on option-linked calendar rows (booking_details.booking_brief). */
  bookingBrief: {
    sectionTitle: 'Booking brief',
    sectionIntro:
      'Structured production information. Choose who can see each field. This is not a chat — use shared notes below for conversation.',
    emptyHint:
      'Add shoot details, location, call time, or deliverables. Defaults to visible to everyone on this booking.',
    shootDetails: 'Shoot details',
    location: 'Location',
    contact: 'Contact',
    callTime: 'Call time',
    deliverables: 'Deliverables',
    visibilityEveryone: 'Everyone on this booking',
    visibilityPrivateAgency: 'Agency only',
    visibilityPrivateClient: 'Client organization only',
    visibilityPrivateModel: 'Model only',
    badgeShared: 'Shared',
    badgePrivate: 'Private',
    saveBrief: 'Save brief',
    savingBrief: 'Saving…',
    briefSaved: 'Brief saved.',
    briefSaveFailed: 'Could not save the booking brief. Please try again.',
    placeholder: 'Enter details…',
  },
  invite: {
    /** Gate screen — not a generic self-service signup. */
    pageTitle: 'Team invitation',
    invalidOrExpired: 'This invitation is invalid or has expired.',
    loadFailed: 'Could not load invitation.',
    /** Primary line on gate. Placeholders: {org}, {role} */
    invitedJoinAs: 'You were invited to join {org} as {role}.',
    /** Secondary line: this is an invite, not creating your own org as owner. */
    inviteNotSelfServiceHint:
      'This is an invitation to an existing team — not a normal sign-up where you create your own organization.',
    invitedToWorkAt: 'You were invited to work with',
    validUntil: 'Valid until',
    sameEmailInstructions:
      'Sign up or sign in with the same email address the invitation was sent to.',
    /** Shown on invite gate: confirm email → sign in → membership finalizes; same link may be reused until expiry. */
    inviteNextStepsAfterSignup:
      'If email confirmation is enabled on your account: confirm your email, then sign in. Your membership is finalized on your first successful sign-in. You may open this same invitation link again if needed before it expires.',
    invalidLink: 'Invalid or expired invitation link.',
    copyLink: 'Copy invitation link',
    linkCopied: 'Link copied',
    previewFailedSignInHint:
      'If you already have an account, please sign in — your invitation will complete automatically.',
    previewFailedBanner:
      'You have a pending team invitation. Sign in or create an account to continue.',
    roleBookerAgency: 'Booker (Agency)',
    roleEmployeeClient: 'Employee (Client)',
    roleMember: 'Member',
    signUpToAccept: 'Create account & accept',
    alreadyHaveAccount: 'I already have an account',
    emailHintPrefix: 'Invitation sent to:',
  },
  inviteErrors: {
    title: 'Invitation Error',
    emailMismatch:
      'This invitation was sent to a different email address. Please sign out and sign in (or create an account) with the email address the invitation was sent to.',
    expiredOrUsed:
      'This invitation link has already been used or has expired. Please ask for a new invitation.',
    alreadyMember:
      'Your account is already a member of another organization. Each account can only belong to one organization at a time. Please use a different email address to accept this invitation, or contact the person who invited you.',
    wrongRole:
      'Your account type does not match this invitation. This can happen if you previously signed up with a different role. Please contact the person who invited you or create a new account with the correct email.',
    genericFail:
      'Could not accept the invitation. Please try again or ask for a new invitation link.',
    signOutBtn: 'Sign out',
    dismissBtn: 'OK',
  },
  modelClaimErrors: {
    title: 'Invitation Error',
    expiredOrUsed:
      'This model invitation link has already been used or has expired. Please ask your agency for a new link.',
    alreadyClaimedByOther:
      'This model profile is already linked to a different account. If this is your profile, please sign in with the email address you used originally — or ask your agency to send a new invite to the correct address.',
    genericFail: 'Could not link your model profile. Please try again or contact your agency.',
    dismissBtn: 'OK',
  },
  modelClaim: {
    pageTitle: 'Claim your model profile',
    invalidOrExpired: 'This invitation is invalid or has expired.',
    loadFailed: 'Could not load the invitation.',
    /** Clarifies this is model profile linking, not a Booker/Employee team invite. */
    notOrgTeamInvite:
      'This link is for claiming your model profile — not for joining an agency or client workspace as Booker or Employee.',
    profileCreatedBy: 'has created a model profile for you on Index Casting.',
    createAccountHint:
      'Create your account to access your portfolio, manage your profile, and connect with clients.',
    expiresNote: 'This invitation link expires in 30 days.',
    /** Shown on model claim gate: email confirm → sign in → claim finalizes; reuse link if needed. */
    modelClaimNextStepsAfterSignup:
      'If email confirmation is enabled: confirm your email, then sign in. Your profile links to this invitation on your first successful sign-in. If it does not, open this same link again before it expires.',
    createAccount: 'Create My Account',
    alreadyHaveAccount: 'I already have an account',
    invalidLink: 'Invalid or expired model invitation link.',
    copyLink: 'Copy invitation link',
    linkCopied: 'Link copied',
    previewFailedSignInHint:
      'If you already have an account, please sign in — your model profile will link automatically.',
    previewFailedBanner:
      'You have a pending model profile invitation. Sign in or create an account to continue.',
  },
  /** One-time banner after accept_organization_invitation / claim_model_by_token succeeds (finalizePendingInviteOrClaim). */
  inviteClaimSuccess: {
    dismiss: 'Dismiss',
    /** Placeholders: {org} */
    joinedOrgBooker: 'You joined the existing organization {org} as Booker.',
    /** Placeholders: {org} */
    joinedOrgEmployee: 'You joined the existing organization {org} as Employee.',
    /** Placeholders: {org} — when member role could not be resolved */
    joinedOrgGeneric: 'You joined {org}.',
    /** No org display name */
    joinedOrgFallback: 'Your team invitation is complete.',
    /** Placeholders: {agency} optional */
    modelProfileConnected: 'Your model profile is now connected.',
    modelProfileConnectedWithAgency: 'Your model profile is now connected ({agency}).',
    /** Combined invite + model claim in one session (banner coalesce). Placeholders: {org}, {role} */
    joinedOrgAndModel: 'You joined {org} as {role}. Your model profile is now connected.',
    /** Placeholders: {org}, {role}, {agency} */
    joinedOrgAndModelWithAgency:
      'You joined {org} as {role}. Your model profile is now connected ({agency}).',
    joinedOrgAndModelFallback:
      'Your team invitation is complete and your model profile is now connected.',
    combinedRoleBooker: 'Booker',
    combinedRoleEmployee: 'Employee',
    combinedRoleOwner: 'Owner',
    combinedRoleTeamMember: 'a team member',
  },
  clientWeb: {
    calendarCalloutTitle: 'Saving to calendar:',
    calendarCalloutBody: 'Sign in with a Client account to save calendar entries.',
    editEvent: 'Edit event',
    /** Sticky bottom navigation (Client workspace). */
    bottomTabs: {
      dashboard: 'Dashboard',
      discover: 'Discover',
      projects: 'My Projects',
      calendar: 'Calendar',
      agencies: 'Agencies',
      team: 'Team',
      billing: 'Billing',
      messages: 'Messages',
      profile: 'Profile',
    },
    workspaceMenu: {
      openLabel: 'More',
      title: 'Workspace',
      subtitle: 'Open other areas of your organization account.',
    },
    /** Selection gallery (shared project) — top bar exit from Discover tab. */
    backToWorkspace: 'Back to workspace',
  },
  auth: {
    inviteLine: 'Invitation: {org} · {role}',
    /** Subtitle when user is in org invite or model claim auth (not self-service). */
    inviteOrClaimContextSubtitle: 'You are completing an invitation — not a standard sign-up.',
    /** Banner when opening model claim link before auth. {agency} = agency display name. */
    modelClaimBannerLine: 'Claim your model profile · {agency}',
    subtitleTagline: 'B2B platform for fashion casting',
    emailPlaceholder: 'Email',
    passwordPlaceholder: 'Password',
    accountTypeFixed: 'Account type: {role} (set by invitation)',
    /**
     * Sign-up/login during org invite. Placeholders: {role} = Booker/Employee label, {accountType} = Agency or Client account type.
     */
    inviteRoleLockedLine:
      'Your role is set by this invitation: {role} (account type: {accountType}).',
    accountScheduledForDeletion:
      'Your account has been scheduled for deletion and is no longer accessible.',
    emailPasswordRequired: 'Email and password are required.',
    /**
     * Shown below the password field in Sign Up mode.
     * Keep in sync with Supabase → Authentication → Email → Password requirements.
     * Current settings: min. 10 chars, lowercase + uppercase + digit + symbol required.
     */
    passwordHintSignup: 'Min. 10 characters · uppercase & lowercase · number · symbol (e.g. !@#$)',
    signUpDisplayNamePlaceholder: 'Display name',
    /**
     * Sign-up placeholder for the organization name field. Stored internally as
     * `profiles.company_name` for legacy reasons, but ALWAYS rendered as
     * "Organization name" in the UI for consistency across signup, settings,
     * chats, calendar, requests etc.
     */
    signUpCompanyNamePlaceholder: 'Organization name',
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
    companyNameRequired: 'Please enter your organization name.',
    loginFailed: 'Login failed. Please check your connection and try again.',
    /** Forgot-password link shown below the Login submit button. */
    forgotPasswordLink: 'Forgot password?',
    /** Title of the forgot-password form (replaces Login/Signup tabs). */
    forgotPasswordTitle: 'Reset your password',
    /** Instruction text below the title in forgot-password mode. */
    forgotPasswordHint: 'Enter your account email and we will send you a reset link.',
    /** Submit button in forgot-password mode. */
    forgotPasswordSend: 'Send Reset Link',
    /** Success text shown after reset email is sent. */
    forgotPasswordSent: 'Reset link sent — check your inbox.',
    /**
     * After sign-up when Supabase returns no session (email confirmation required).
     * Plain signup / owner path — no invite token context.
     */
    signUpEmailConfirmationRequired:
      'Check your email — we sent a confirmation link. Open it to verify your address, then sign in with the password you chose.',
    /** Extra guidance when signing up from an organization invitation link (append or second line). */
    signUpEmailConfirmationInviteNote:
      'After you confirm and sign in, your invitation will complete automatically. If you open the confirmation email on a different device or browser, please also re-open your original invitation link afterwards so your membership can be finalized.',
    /** Extra guidance when signing up from a model claim link. */
    signUpEmailConfirmationModelClaimNote:
      'After you confirm and sign in, your model profile should link automatically. If you open the confirmation email on a different device or browser, please also re-open your original invitation link afterwards so your profile can be connected.',
    /** Link to go back from forgot-password mode to login. */
    forgotPasswordBack: 'Back to login',
    /** Title of the set-new-password screen (shown after clicking reset link). */
    setPasswordTitle: 'Set new password',
    /** Instruction text on set-new-password screen. */
    setPasswordHint: 'Choose a new secure password for your account.',
    /** Placeholder for the new-password field. */
    setPasswordNew: 'New password',
    /** Placeholder for the confirm-password field. */
    setPasswordConfirm: 'Confirm new password',
    /** Submit button on set-new-password screen. */
    setPasswordSave: 'Save new password',
    /** Success message after password is updated (shown before redirect to login). */
    setPasswordSuccess: 'Password updated successfully. Please log in with your new password.',
    /** Error when both password fields do not match. */
    setPasswordMismatch: 'Passwords do not match.',
    /** Error when reset email could not be sent. */
    resetEmailFailed: 'Could not send the reset email. Please try again.',
    /** Error when updateUser password call fails. */
    updatePasswordFailed: 'Could not update your password. Please try again.',
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
    personalDeleteDescription:
      'Remove your personal account from this platform. You will be removed from your organization and your account will be scheduled for deletion.',
    personalDeleteConfirmTitle: 'Delete your account?',
    personalDeleteConfirmMessage:
      'You will be removed from your organization and your account will be scheduled for deletion. Data is kept for 30 days, then permanently removed. Continue?',
    dissolveOrgTitle: 'Delete organization',
    dissolveOrgDescription:
      'This removes the organization workspace, all team memberships, and pending invitations. Other linked records (projects, requests, billing, subscriptions, etc.) may still exist or prevent deletion if the database blocks it — contact support if removal fails. This cannot be undone for the workspace. After deleting the organization, you can also delete your personal account.',
    dissolveOrgConfirmTitle: 'Permanently delete this organization?',
    dissolveOrgConfirmMessage:
      'This action cannot be undone. The organization workspace, every team membership and pending invitation will be removed immediately, your active subscription will be cancelled with Stripe, and your team will be notified. All shared organization data (bookings, options, conversations, projects, calendar entries, billing records) will be permanently erased after a 30-day grace period. If you want to keep a copy of your data, cancel now and use "Download my data" first. Click "Delete organization" to confirm.',
    dissolveOrgButton: 'Delete organization',
    dissolveOrgWorking: 'Deleting organization…',
    dissolveOrgSuccess:
      'Organization deleted. Your subscription has been cancelled and your team has been notified. All shared data will be permanently erased in 30 days. You can now delete your personal account below or download your personal data first.',
    dissolveOrgStripeWarning:
      'Organization deleted, but we could not cancel your Stripe subscription automatically. Please cancel it manually or contact support — billing will not renew further once the data purge runs.',
    dissolveOrgBannerTitle: 'Your organization has been closed',
    dissolveOrgBannerMessage:
      'The organization you belonged to was permanently dissolved by its owner. You can still log in to manage your personal account: download your data (GDPR) or delete your account. All shared organization data will be permanently erased on {purgeDate}.',
    dissolveOrgBannerDownload: 'Download my data',
    dissolveOrgBannerDelete: 'Delete my account',
    dissolveOrgBannerDismiss: 'Dismiss',
    dissolveOrgFailed: 'Could not delete the organization. Please try again.',
    /** Dissolve RPC returned forbidden_not_owner (defensive; owner UI is normally gated). */
    dissolveOrgNotOwner: 'Only the organization owner can delete the organization.',
    /** Caller session missing — should be rare from authenticated settings. */
    dissolveNotSignedIn: 'You must be signed in to delete the organization.',
    /**
     * Org row cannot be removed because related business data still references it.
     * Operational follow-up: use full org purge RPC or support-assisted cleanup.
     */
    dissolveOrgFailedDependencies:
      'The organization could not be deleted because related records still exist. Please contact support if this persists.',
    /** After soft-delete RPC succeeds; user is signed out next. */
    scheduledDeletionTitle: 'Deletion scheduled',
    scheduledDeletionBody:
      'Your account deletion has been scheduled. You will be signed out. Data is removed after the retention period.',
  },
  /** B2B organization public profile — logo/gallery (web + native). */
  organizationProfile: {
    removeLogoTitle: 'Remove logo?',
    removeLogoMessage: 'Remove the current logo from your profile?',
    removeLogoFailed: 'Could not remove logo. Please try again.',
    logoUploadFailedTitle: 'Upload failed',
    logoUploadFailedMessage: 'Could not upload logo. Please try again.',
    removeGalleryImageTitle: 'Remove image?',
    removeGalleryImageMessage: 'Remove this image from your gallery?',
    removeGalleryImageFailed: 'Could not remove image. Please try again.',
    galleryUploadAllFailedTitle: 'Upload failed',
    galleryUploadAllFailedMessage: 'Could not upload images. Please try again.',
    galleryUploadSomeFailedTitle: 'Some uploads failed',
    galleryUploadSomeFailedBody:
      '{failed} of {total} image(s) could not be uploaded. Others were added.',
  },
  app: {
    crashTitle: 'Something went wrong',
    crashBody: 'Something went wrong in the application. Please reload the page or try again.',
    supabaseMissing: 'The application is not properly configured. Please contact support.',
    /** Shown when session exists but profile is still loading (avoids a silent spinner). */
    profileLoadingTitle: 'Loading your profile…',
    profileLoadingHint:
      'This usually takes a few seconds. If it takes too long, check your connection.',
    /** Shown on Auth when URL contains a shared selection — re-open link after sign-in if needed. */
    sharedListSignInHint:
      'You opened a shared model list. After signing in, open the same link again if the list does not appear.',
    /** Fallback when invite/claim success banner text resolver fails (success still applied). */
    inviteClaimSuccessFallback: 'We connected your account. Some details could not be loaded.',
  },
  apply: {
    displayNameMissing:
      'Display name is missing in your profile. Add a name under Account and try again.',
    firstNameRequired: 'Please enter first name.',
    nameRequired: 'Please enter first and last name.',
    nameLockedHint:
      'Matches your account name (profile) and cannot be changed here. Two words = first and last name; one word = first name only.',
    /** Web: HEIC conversion is not bundled reliably; apply form blocks early with visible copy. */
    heicNotSupportedWeb: 'HEIC images are not supported in web upload yet. Please use JPG or PNG.',
  },
  model: {
    selectAgencyTitle: 'Select your agency profile',
    selectAgencySubtitle:
      'You are represented by multiple agencies. Choose which profile to start with.',
    noAgencyProfiles: 'You are not currently represented by any agency.',
    /** Settings + messages: CTA when MAT empty but model account exists (after end representation). */
    applyToAgenciesCta: 'Apply to an agency',
    /** Model profile settings when MAT list is empty (first-time or after end representation). */
    applyWhenNoAgencyHint: 'Submit an application to connect with an agency.',
    /** Banner shown on the model profile right after returning from a successful Apply submit. */
    applicationSubmittedBanner:
      'Application submitted. Agencies will get back to you here when they respond.',
    representationEndedApplyHint:
      'Representation with this agency has ended. You can apply again; past chats may still appear under Messages.',
    /** Shown under agency name when multiple MAT territories exist (same agency = one profile). */
    representationTerritories: 'Territories',
    /** Shown when opening agency direct chat but MAT no longer ties model to that agency (history only). */
    agencyDirectChatRepresentationEnded:
      'You are no longer represented by this agency. Past messages stay available below.',
    switchAgencyLabel: 'Switch agency',
    /** Small kicker above agency name rows in chat lists (not the org name itself). */
    agencyChatRowKicker: 'Agency',
    /** @deprecated Prefer agencyChatRowKicker or b2bChat.conversationFallback */
    agencyLabel: 'Agency',
    chatsSubtitle: 'Chats with agencies that responded to your application.',
    noAgencyMessages: 'No messages from agencies yet.',
    /** CTA: bootstrap or open direct chat with the active representation agency. */
    messageYourAgency: 'Message your agency',
    ensureAgencyChatFailed: 'Could not open chat with your agency. Please try again.',
    openChat: 'Open chat',
    applicationDefaultsSubtitle: 'Default details for your applications.',
    noApplicationsYet: 'No applications yet. Create an application first to edit defaults.',
    agencyChatSectionLabel: 'Organization chat',
    agencyChatSectionSubtitle: 'Direct chat with your representation',
    /** Small label above recruiting thread title in chat list (not the org name). */
    recruitingChatRowKicker: 'Recruiting',
    directMessagesSectionLabel: 'Direct messages',
    directMessagesSectionSubtitle: 'Messages sent directly by your agency',
    composerPlaceholder: 'Message…',
    /** Label above job_description in option/casting thread header (model). */
    optionThreadRoleDetails: 'Role / details',
  },
  login: {
    /** Role-picker entry (e.g. dev / secondary entry) — not a full auth product path. */
    rolePickerHelper:
      'Choose how you want to continue. You will open that workspace after you continue.',
    brandTitle: 'INDEX CASTING',
    brandSubtitle: 'B2B platform for fashion casting.',
    sectionAccess: 'Access',
    accessCopy: 'Verified agencies and brands only. Use your work email to request access.',
    roleLabelSelect: 'Select role',
    continueAs: (roleLabel: string) => `Continue as ${roleLabel}`,
    chooseRoleToContinue: 'Choose a role to continue',
    linkCouldNotOpen: 'Could not open the link. Check your browser or try copying the URL.',
    roleClient: 'Client',
    roleModel: 'Model',
    roleAgency: 'Agency',
    roleSelectPlaceholder: 'Select role',
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
    saveFailed:
      'Could not save settings. Make sure you are signed in as the organization owner and try again.',
    saveSuccess: 'Settings saved.',
    saveError: 'Could not save settings. Please try again.',
    bookerNoAccess: 'Only the organization owner can edit agency settings.',
  },
  /** Agency — My Models manual editor (portfolio + polaroids). */
  modelRoster: {
    visibleInClientSwipe: 'Visible to clients',
    portfolioTitle: 'Portfolio images',
    portfolioHint: 'First image is the cover for client swipe. Reorder with arrows or tap Cover.',
    polaroidsTitle: 'Polaroids',
    polaroidsHint: 'Separate from portfolio. Only images marked visible appear in client swipe.',
    territoriesTitle: 'Territories of Representation',
    territoriesHint:
      'Select at least one country where this agency represents the model. Required.',
    territoriesSearchPlaceholder: 'Search by country code or name…',
    noTerritoriesSelected: 'No territories selected.',
    territoriesRequiredTitle: 'Territory required',
    territoriesRequiredBody:
      'You must select at least one territory where you represent this model. Use the search below to find and assign a country.',
    territoriesRequiredInline: 'Select at least one territory to save.',
    territoriesMissingBadge: 'No territory',
    /** Alert title when territory RPC save fails (e.g. network or server error). */
    territoriesSaveFailedTitle: 'Could not save territories',
    /** Appended below the technical error message — no legacy SQL filenames. */
    territoriesSaveSupportFooter:
      'Please try again. If the problem persists, contact support with the details above.',
    photosMissingBadge: 'No photos',
    incompleteModelsBanner: (count: number) =>
      `${count} model${count === 1 ? '' : 's'} not visible to clients — required fields missing`,
    incompleteModelsBannerSuffix: 'Open the model to see what is missing.',
    pickFromLibrary: 'Pick from library',
    addPolaroidUrlPlaceholder: 'Paste polaroid image URL',
    portfolioRequiredTitle: 'Portfolio required',
    portfolioRequiredBody:
      'Enable at least one portfolio image with visible client swipe so clients can see this model.',
    modelNamePlaceholder: 'Model name\u2026',
    searchByNamePlaceholder: 'Search by name\u2026',
    searchCountryPlaceholder: 'Search country\u2026',
    searchModelsPlaceholder: 'Search models\u2026',
    searchClientsPlaceholder: 'Search clients\u2026',
    modelSignupEmailPlaceholder: 'Model signup email (same as profile)',
    /** Roster email edit would match another account not linked to this model — use claim/invite instead. */
    emailMatchesExistingAccountTitle: 'Email already in use',
    emailMatchesExistingAccountBody:
      'This email belongs to an existing account that is not linked to this model. Use the model claim or invite flow to link the profile instead of changing the email here.',
    mediaslideApiKeyPlaceholder: 'Mediaslide API Key',
    netwalkApiKeyPlaceholder: 'Netwalk API Key',
    importUrlPlaceholder: 'https://\u2026/model.json',
    emailPlaceholder: 'Email',
    /** Shown after merge/import when Mediaslide/Netwalk sync IDs could not be saved to an existing row. */
    externalSyncIdsPersistWarning:
      ' External sync IDs (Mediaslide/Netwalk) could not be saved — try saving again from the integration or contact support.',
    /** Bulk pair-by-email — finds Mediaslide / Netwalk records for unpaired models with an email on file. */
    bulkPairTitle: 'Auto-pair models by email',
    bulkPairSubtitle:
      'For every model that has an email but no Mediaslide / Netwalk link yet, search the connected systems and link the matching record. Existing pairings are not changed.',
    bulkPairButton: 'Auto-pair by email',
    bulkPairRunning: 'Searching connected systems\u2026',
    bulkPairNoCandidates: 'No unpaired models with an email on file.',
    bulkPairNoConnection: 'Connect Mediaslide or Netwalk above before running auto-pair.',
    bulkPairResult: (paired: number, scanned: number, ambiguous: number) =>
      `Auto-pair complete \u2014 linked ${paired} of ${scanned} candidates${ambiguous > 0 ? ` (${ambiguous} skipped: multiple matches)` : ''}.`,
    bulkPairFailed: 'Auto-pair failed \u2014 see console for details.',
    /** Single-model profile save (Agency My Models editor). */
    modelSaveSuccess: 'Settings saved successfully',
    modelSaveFailed: 'Save failed — please try again',
    modelSaveButton: 'Save settings',
    viewList: 'List',
    viewGallery: 'Gallery',
    modelInviteEmailSentNote: (email: string) => `Invitation email sent to ${email}.`,
    modelInviteEmailFailedNote: (reason: string) => `Invitation email was not sent: ${reason}.`,
    modelInviteManualLinkNote: 'Share this claim link with the model manually:',
    modelInviteSkippedAlreadyLinkedNote: 'Model account is already linked — invite skipped.',
    /** Near me filter: consent before device location + Nominatim (agency roster / package builder). */
    nearMeGeoConsentTitle: 'Location for Near me',
    nearMeGeoConsentBody:
      'To filter models by distance, IndexCasting needs your approximate location. Coordinates are rounded for privacy and may be sent to OpenStreetMap Nominatim to detect your city. Continue?',
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
    clientsSectionSubtitle:
      'Search client organizations (not individuals). Start an organization-to-organization chat.',
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
    /** Last resort when no meaningful title is available (B2B threads, messenger labels). */
    conversationFallback: 'Conversation',
    /** @deprecated Use conversationFallback — kept for legacy string references */
    chatPartnerFallback: 'Conversation',
    /** @deprecated Use conversationFallback */
    agencyFallback: 'Conversation',
    /** @deprecated Use conversationFallback */
    clientFallback: 'Conversation',
    openConversation: 'Open chat',
    /** Accessibility label for blue unread dot on B2B thread rows */
    unreadMessagesIndicatorA11y: 'Unread messages',
    contextOrgChat: 'Org chat',
    /** Agency ↔ model direct thread (context_id agency-model:…), not a client org chat. */
    modelDirectThreadContext: 'Direct chat with model',
    /** Shown under thread context when the model is no longer on the agency roster. */
    agencyModelDirectRepresentationEnded:
      'This model is not on your roster. Representation has ended; you can still read the history.',
    contextNegotiationThread: 'Negotiation thread',
    openOrgChat: 'Open org chat',
    openRelatedRequest: 'Open related request',
    relatedRequestUnavailable: 'No related request linked yet.',
    messagePlaceholder: 'Message…',
    /** B2B + option threads: fetch earlier history when the initial page is full */
    loadOlderMessages: 'Load older messages',
    send: 'Send',
    attachPhoto: 'Photo',
    attachFile: 'File',
    uploading: 'Uploading…',
    uploadFailed: 'Upload failed. Please try again.',
    openFile: 'Open file',
    imageAttachment: 'Image',
    fileAttachment: 'Attachment',
    sharePackage: 'Share package',
    shareModel: 'Share model',
    sharedPackage: 'Package',
    sharedPackageBody: 'Shared a model package',
    sharedModel: 'Model',
    sharedModelBodyPrefix: 'Shared model:',
    modelsCount: 'models',
    bookingCardTitle: 'Booking',
    optionCardTitle: 'Option',
    castingCardTitle: 'Casting',
    bookingModelLabel: 'Model',
    bookingDateLabel: 'Date',
    bookingStatusLabel: 'Status',
    bookingStatusRemoved: 'Removed',
    bookingStatusDeclined: 'Declined',
    openPackage: 'Open package',
    modelIdLabel: 'Model ID',
    pickPackage: 'Choose a package to share',
    pickPackageHint:
      'The client will open this directly in their Discover tab with full booking access.',
    pickModel: 'Choose a model to share',
    packagePreviewLabel: 'models in this package',
    requestFromPackage: 'Request from this package',
    packageNoPreview: 'No preview available',
    /** Client opens shared package from chat — metadata RPC returned no row (invalid, expired, or inactive). */
    packageNotFoundOrExpired: 'Package not found or has expired.',
    /** Models RPC failed (network, API config, or server) — do not show as empty package. */
    packageModelsLoadFailed:
      'Could not load models for this package. Check your connection and try again.',
    /** Client opens shared package — RPC/network failure (distinct from invalid link). */
    packageLoadFailed: 'Could not load package. Please try again.',
    exitPackageMode: 'Back to Discover',
    /** Package access-level badges shown on the chat card. */
    packageBadgeFullAccess: 'Full Client Access',
    packageBadgeGuestAccess: 'Guest Access',
    /** Labels for the two distinct sharing methods. */
    shareMethodInApp: 'In-App (Registered Client)',
    shareMethodExternal: 'External Link (Guest)',
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
    migrationRequiredResolveRpc: 'This feature is temporarily unavailable. Please contact support.',
    /** PostgREST: create chat RPC missing */
    migrationRequiredCreateB2bRpc: 'Could not start chat. Please try again or contact support.',
    migrationRequiredB2bOrgDirectory:
      'Could not load the directory. Please try again or contact support.',
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
  messages: {
    searchPlaceholder: 'Search chats and models…',
    searchPlaceholderClient: 'Search agency chats…',
    searchSectionClientChats: 'Client chats',
    searchSectionRecruiting: 'Recruiting chats',
    searchSectionOptionRequests: 'Option requests',
    searchSectionModels: 'Models — start new chat',
    searchNoResults: 'No results for your search.',
    modelNoAccount: 'No account yet',
    startChat: 'Start chat',
    openChat: 'Open chat',
    modelDirectChatFailed: 'Could not open chat with this model. Please try again.',
    modelDirectChatNoRepresentation:
      'Chat is only available when this model has an active territory of representation with your agency. Add a territory or restore the relationship, then try again.',
    deleteOptionRequestTitle: 'Delete this request?',
    deleteOptionRequestMessage:
      'This removes the option or casting request for everyone before the job is confirmed. Calendars and threads will be cleared. This cannot be undone.',
    deleteOptionRequestFailed: 'Could not delete this option request. Please try again.',
    deleteOptionRequestNotAllowed:
      'This option request cannot be deleted because the job was already confirmed.',
    /** Option request list: archive is local list visibility only — not a server delete. */
    optionRequestListFilterCurrent: 'Current',
    optionRequestListFilterArchived: 'Archived',
    archiveThreadInListAccessibility: 'Archive in this list',
    unarchiveThreadInListAccessibility: 'Move back to current list',
    archiveThreadDoesNotDeleteShort:
      'Archiving only hides the thread in this list. Open it and use Delete to remove the request and calendars for everyone.',
    /** Mobile back label in B2B chat panel messenger — returns to thread list. */
    backToChats: 'Chats',
  },
  /** Recruiting chat RPC errors and messages. */
  recruiting: {
    chatForbidden: 'No permission: sign in as an agency organization member.',
    chatWrongAgency: 'This application belongs to a different agency.',
    chatNotPending: 'Recruiting chat is only available while the application is pending.',
    chatSignInAgain: 'Please sign in again.',
    chatApplicationNotFound: 'Application not found.',
    chatLinkFailed:
      'Could not link the recruiting thread to the application. Check the database or contact support.',
    chatSchemaMismatch: 'Could not start chat. Please try again or contact support.',
    chatServerError: 'A server error occurred. Please try again later.',
    chatPermissionDenied: 'You do not have permission to perform this action.',
    chatFunctionMissing: 'This feature is temporarily unavailable. Please contact support.',
    chatGenericFailed: 'Could not start recruiting chat. Check your connection and try again.',
    /** Swipe limit — displayed in the pending queue. */
    dailySwipeCounter: (used: number, limit: number) => `Daily Swipes: ${used} / ${limit}`,
    limitReachedMessage: "You've reached your daily limit. Upgrade to continue.",
    upgradeCTA: 'Upgrade Plan',
    title: 'Recruiting',
    noAcceptedApplications: 'No accepted applications',
    acceptedModelsHint: 'Accepted models will appear here.',
    awaitingModelConfirmation: 'Awaiting model confirmation',
    chat: 'Chat',
    yourListIsEmpty: 'Your list is empty',
    noEntriesLeft: 'No entries left',
    details: 'Details',
    inChat: 'In chat',
    tapForDetails: 'Tap for application details',
    addToList: 'Add to List',
    noPendingApplications: 'No pending applications',
    photos: 'Photos',
    noPhoto: 'No photo',
    tapToEnlarge: 'Tap image to enlarge \u00B7 Use arrows to browse photos',
    applicationDetails: 'Application details',
    decline: 'Decline',
    tapToClose: 'Tap to close',
  },
  /** Organization name validation and management errors. */
  org: {
    nameEmpty: 'Organization name must not be empty.',
  },
  /** Territory selection — modal on accept + bulk assign. */
  territoryModal: {
    title: 'Add Countries of Representation',
    subtitle: 'Select countries to add. Existing territories are kept — this is additive.',
    searchPlaceholder: 'Search country…',
    confirmButton: 'Confirm & Accept',
    confirmBulkButton: 'Add Territories to Selected Models',
    requiredHint: 'Select at least one country to continue.',
    noCountriesFound: 'No countries match your search.',
    assignSuccess: 'Territories assigned.',
    assignFailed: 'Could not save territories. Please try again.',
    bulkAssignSuccess: 'Territories added to selected models (existing territories preserved).',
    bulkAssignFailed: 'Could not assign territories. Please try again.',
    selectModelsFirst: 'Select at least one model first.',
    activeModelBadge: 'Active Model',
    recruitingBadge: 'Recruiting',
    bulkAdditiveNote: 'Adds to existing — does not remove previously set territories.',
  },
  /** Booking event lifecycle labels. */
  bookingStatus: {
    pending: 'Pending',
    agencyAccepted: 'Agency Accepted',
    modelConfirmed: 'Model Confirmed',
    completed: 'Completed',
    cancelled: 'Cancelled',
    markAgencyAccepted: 'Accept booking',
    markModelConfirmed: 'Confirm as model',
    markCompleted: 'Mark as completed',
    markCancelled: 'Cancel booking',
    statusLabel: 'Booking status',
    updateFailed: 'Could not update booking status.',
    updateSuccess: 'Booking status updated.',
  },
  /** Bulk model selection — agency roster: territories of representation only (no bulk current location). */
  bulkActions: {
    selectedCount: '{count} model(s) selected',
    assignTerritories: 'Assign Territories',
    selectForTerritoriesHint: 'Select models to assign territories',
    clearSelection: 'Clear selection',
  },
  /** Agency single-model editor: current location / agency model_locations row (not bulk). */
  locationModal: {
    title: 'Set Model Location',
    subtitle: 'This location will be used for proximity-based client discovery.',
    countryLabel: 'Country',
    countryPlaceholder: 'Search country…',
    cityLabel: 'City (optional)',
    cityPlaceholder: 'e.g. Berlin',
    confirm: 'Save Location',
    successSingle: 'Location updated.',
    error: 'Could not save location. Please try again.',
  },
  /** Calendar input validation. */
  calendarValidation: {
    invalidDateFormat: 'Invalid date format. Use YYYY-MM-DD.',
    insertFailed: 'Could not save calendar entry. Please try again.',
    duplicateEvent: 'An event with the same title already exists on this date.',
    conflictWarningTitle: 'Schedule Conflict',
    conflictWarningMessage:
      'This model already has a booking on this date: {{entries}}. You can still submit the request.',
  },
  adminDashboard: {
    deletePermanentlyTitle: 'Delete account permanently',
    deletePermanentlyMessage:
      'This will permanently delete all profile data for this user. The user will no longer be able to sign in. Continue?',
    deleteData: 'Delete data',
    purgeSuccess: 'Profile data deleted successfully.',
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
    /** Organizations tab */
    orgsTabTitle: 'Organizations',
    orgsSearchPlaceholder: 'Search organizations...',
    orgsEmpty: 'No organizations found.',
    orgActiveLabel: 'Active',
    orgInactiveLabel: 'Inactive',
    orgDeactivateBtn: 'Deactivate',
    orgActivateBtn: 'Activate',
    orgEditNameLabel: 'Name',
    orgChangeOwnerLabel: 'Transfer Owner',
    orgChangeOwnerPlaceholder: 'Select new owner...',
    orgAdminNotesLabel: 'Admin Notes (internal only)',
    orgAdminNotesPlaceholder: 'Internal notes, not visible to users...',
    orgSaveChanges: 'Save Changes',
    orgSaved: 'Organization updated.',
    orgSaveFailed: 'Could not update organization. Check console.',
    orgToggleActiveFailed: 'Could not change organization status.',
    orgToggleActiveConfirmTitle: 'Change organization status?',
    editorSaveChanges: 'Save Changes',
    editorActiveLabel: 'Active',
    editorEmptyState: 'Select a profile from the Accounts tab to edit.',
    swipeResetConfirmTitle: 'Reset daily swipe count?',
    swipeResetConfirmBody: (name: string) =>
      `Reset today's swipe counter for "${name}"? This cannot be undone.`,
    swipeResetConfirmBtn: 'Reset',
    orgDeactivateConfirmBody: (name: string) =>
      `Deactivate "${name}"? Members will lose platform access until reactivated.`,
    orgActivateConfirmBody: (name: string) =>
      `Activate "${name}"? Members will regain platform access (subject to plan).`,
    orgMembersCount: '{n} member(s)',
    /** Models tab */
    modelsTabTitle: 'Models',
    modelsSearchPlaceholder: 'Search models...',
    modelsEmpty: 'No models found.',
    modelActiveLabel: 'Active',
    modelInactiveLabel: 'Inactive (hidden from discovery)',
    modelDeactivateBtn: 'Deactivate',
    modelActivateBtn: 'Activate',
    modelAdminNotesLabel: 'Admin Notes (internal only)',
    modelAdminNotesPlaceholder: 'Internal notes, not visible to users...',
    modelNotesSaved: 'Notes saved.',
    modelNotesFailed: 'Could not save notes.',
    modelToggleActiveFailed: 'Could not change model status.',
    /** Org-deactivated gate screen */
    orgDeactivatedTitle: 'Organization Deactivated',
    orgDeactivatedBody: 'Your organization has been deactivated. Please contact support.',
    /** Agency swipe limit admin controls */
    swipeLimitTitle: 'Swipe Limit',
    swipeLimitUsed: 'Used today',
    swipeLimitMax: 'Daily limit',
    swipeLimitLastReset: 'Last reset',
    swipeLimitSave: 'Save Limit',
    swipeLimitReset: 'Reset Usage',
    swipeLimitSaveSuccess: 'Limit saved.',
    swipeLimitResetSuccess: 'Usage reset.',
    swipeLimitSaveFailed: 'Could not save limit.',
    swipeLimitResetFailed: 'Could not reset usage.',
    orgConvertToAgency: 'Convert to Agency',
    orgConvertToClient: 'Convert to Client',
    orgConvertConfirmTitle: 'Convert organization type',
    orgConvertToAgencyConfirm:
      'This will convert this Client organization to an Agency. All Employees will become Bookers and member profiles will be updated to Agent. Continue?',
    orgConvertToClientConfirm:
      'This will convert this Agency organization to a Client. All Bookers will become Employees and member profiles will be updated to Client. Continue?',
    orgConvertSuccess: 'Organization type converted successfully.',
    orgConvertFailed: 'Could not convert organization type. Check console.',
    orgConvertConfirm: 'Convert',
  },
  /** Admin — Health & Events tab (observability dashboard). */
  adminHealth: {
    tabLabel: 'Health & Events',
    sectionOverview: 'Overview',
    sectionHealthChecks: 'Health Checks',
    sectionViolations: 'Invariant Violations',
    sectionEvents: 'Recent Events (24h)',
    refreshBtn: 'Refresh',
    refreshing: 'Refreshing…',
    lastUpdated: 'Last updated',
    overallOk: 'All systems operational',
    overallDegraded: 'Some checks degraded',
    overallDown: 'Active incidents',
    overallUnknown: 'Status unknown',
    statusOk: 'OK',
    statusDegraded: 'Degraded',
    statusDown: 'Down',
    statusUnknown: 'Unknown',
    severityInfo: 'Info',
    severityWarning: 'Warning',
    severityCritical: 'Critical',
    publicBadge: 'Public',
    privateBadge: 'Internal',
    checkLastRun: 'Last run',
    checkLastOk: 'Last OK',
    checkDetails: 'Details',
    noChecks: 'No health checks configured.',
    activeViolations: 'Active',
    resolvedViolations: 'Resolved',
    noViolationsActive: 'No active violations. ✓',
    noViolationsAtAll: 'No violations recorded.',
    violationDetectedAt: 'Detected',
    violationResolvedAt: 'Resolved',
    violationCountValue: 'Count / Value',
    eventsByLevel: 'Events by level (last 24h)',
    eventsTotal: 'Total events',
    noEvents: 'No events in the last 24 hours.',
    recentEventStream: 'Recent event stream',
    eventLevelFilter: 'Level',
    eventLevelAll: 'All',
    eventLevelWarn: 'Warn+',
    eventLevelError: 'Errors only',
    noEventStream: 'No events match this filter.',
    loadFailed: 'Could not load health data. Check console.',
    notAdmin: 'Admin access required.',
    never: 'never',
    eventColumnTime: 'Time',
    eventColumnLevel: 'Level',
    eventColumnSource: 'Source',
    eventColumnEvent: 'Event',
    eventColumnMessage: 'Message',
  },
  /** Agency — model profile edit panel (My Models detail view). */
  modelEdit: {
    sectionIdentity: 'Identity',
    sectionSex: 'Sex',
    sectionMeasurements: 'Measurements',
    sectionAppearance: 'Appearance',
    sectionEthnicity: 'Ethnicity',
    sectionLocation: 'Location',
    sectionSegment: 'Segment & Sport',
    sectionMotherAgency: 'Mother Agency',
    nameLabel: 'Name',
    emailLabel: 'Model Email',
    namePlaceholder: 'Full name',
    emailPlaceholder: 'Model email address',
    heightPlaceholder: 'e.g. 178',
    chestPlaceholder: 'e.g. 90',
    waistPlaceholder: 'e.g. 65',
    hipsPlaceholder: 'e.g. 92',
    legsInseamPlaceholder: 'e.g. 82',
    shoeSizePlaceholder: 'e.g. 40',
    cityPlaceholder: 'e.g. Berlin',
    currentLocationPlaceholder: 'e.g. Paris',
    measurementOptionalHelper: 'Optional',
    categoryHint: '(leave empty = visible to all clients)',
    ethnicitySelectLabel: 'Select ethnicity',
    countrySelectLabel: 'Select country',
    sexNotSpecified: 'Not specified',
    sexFemale: 'Female',
    sexMale: 'Male',
    heightLabel: 'Height (cm)',
    chestLabel: 'Chest (cm)',
    waistLabel: 'Waist (cm)',
    hipsLabel: 'Hips (cm)',
    legsInseamLabel: 'Legs inseam (cm)',
    shoeSizeLabel: 'Shoe size',
    hairColorLabel: 'Hair Color',
    eyeColorLabel: 'Eye Color',
    countryLabel: 'Country',
    /** Saving city with country also updates map / Near Me (agency location row). Without country, city and current location still save on the model profile. */
    countryNearMeHint:
      'Select a country to pin city on the map for Near Me. City and Current Location are always saved on the profile.',
    cityLabel: 'City',
    currentLocationLabel: 'Current Location',
    categoryLabel: 'Categories',
    shareLocationToggle: 'Share approximate location',
    shareLocationHint:
      'Enables radius-based discovery. Only a rounded area (~5 km) is shared — never exact GPS.',
    shareLocationSaved: 'Location saved.',
    shareLocationError: 'Could not save location. Please try again.',
    motherAgencyHint:
      'Optional. Free text — only fill in if another agency primarily represents this model. ' +
      'Never auto-imported from MediaSlide / Netwalk.',
    motherAgencyNameLabel: 'Mother Agency Name',
    motherAgencyNamePlaceholder: 'e.g. New Madison Paris',
    motherAgencyContactLabel: 'Mother Agency Contact (agency-internal)',
    motherAgencyContactPlaceholder: 'Booker email, phone, or name',
    motherAgencyContactInternalNote:
      'Visible to your agency members only. Clients see only the mother agency name.',
  },
  /** Sports categories on model profiles and client filters. */
  sportCategories: {
    sectionLabel: 'Sport Categories',
    sectionHint: '(optional — multi-select)',
    winterSports: 'Winter Sports',
    summerSports: 'Summer Sports',
    filterLabel: 'Sport',
  },
  /** Agency — Guest Links tab (external sharing). */
  guestLinks: {
    tabTitle: 'Links',
    createSection: 'Create Package',
    packageNamePlaceholder: 'Package name (e.g. "Summer Castings 2025")',
    packageNameRequired: 'Please enter a package name.',
    selectModelsHint: 'Select models to include in this package:',
    noModelsSelected: 'Select at least one model.',
    createPackageButton: 'Create Package',
    packagesSection: 'My Packages',
    copyGuestLinkButton: 'Copy Guest Link',
    copiedButton: 'Copied!',
    sendInAppButton: 'Send in App',
    deactivateButton: 'Deactivate',
    deleteButton: 'Delete',
    deleteConfirmTitle: 'Delete Package?',
    deleteConfirmMessage: 'This link will be permanently removed and can no longer be opened.',
    deleteConfirmOk: 'Delete',
    deleteConfirmCancel: 'Cancel',
    deleteFailedMessage: 'Could not delete the package. Please try again.',
    noLinksYet: 'No packages yet. Create your first package above.',
    createPackageError: 'Could not create package. Please check your connection and try again.',
    activeLabel: 'Active',
    inactiveLabel: 'Inactive',
    modelsCount: (n: number) => `${n} model${n === 1 ? '' : 's'}`,
    guestLinkHint: 'External link — no account required, guest access only.',
    inAppHint: 'Registered clients only — full booking tools.',
    sendInAppModalTitle: 'Send Package to Client',
    sendInAppModalHint: 'Choose a registered client organization to send this package to.',
    sendInAppNoChats:
      'No active B2B chats found. Open a chat thread with a client in Messages first.',
    sendInAppLoading: 'Loading chats…',
    sendInAppSending: 'Sending…',
    sendInAppSuccess: 'Package sent successfully.',
    sendInAppError: 'Could not send the package. Please try again.',
    sendInAppCancelButton: 'Cancel',
    sectionTitle: 'External Package Links',
    sectionDescription:
      'Generate a link to share with clients who do not have an account. They can browse the package as a guest and send you a request.',
    generateButton: 'Generate Link',
    copyButton: 'Copy Link',
    accessLevelHint: 'Guest access only — no booking tools',
    vs: 'vs.',
    inAppAlternative:
      'To share a package with a registered client organization, use the "Share package" button in a B2B chat thread.',
    /** Package type selector — Step 1 of package creation. */
    packageTypeLabel: 'Package Type',
    packageTypePortfolio: 'Portfolio',
    packageTypePolaroid: 'Polaroid',
    packageTypeMixed: 'Both',
    packageTypePortfolioHint: 'Shows only portfolio images — used for standard client discovery.',
    packageTypePolaroidHint:
      'Shows only polaroid images — used for casting agencies that require measurement shots.',
    packageTypeMixedHint:
      'Includes portfolio and polaroid images — viewers can switch between the two.',
    packageTypeMixedLabel: 'Portfolio + Polaroid',
  },
  /** Client Discover tab — package mode overlay + agency chat action. */
  discover: {
    viewingPackage: 'Viewing Package',
    exitPackage: 'Exit Package',
    chatWithAgency: 'Chat with Agency',
    chatWithAgencyLoading: 'Opening chat…',
    noMoreModels: 'No more models right now.',
    noMoreModelsSub: 'Check back soon for new talent, or adjust your filters.',
    /** Model detail modal — labels use typography.label (uppercase on web). Never use legacy DB field name "bust". */
    detailMeasurementHeight: 'Height',
    detailMeasurementChest: 'Chest',
    detailMeasurementWaist: 'Waist',
    detailMeasurementHips: 'Hips',
    /** Client web detail modal — image section when viewing a portfolio package. */
    detailMediaSectionPortfolio: 'Portfolio',
    /** Client web detail modal — image section when viewing a polaroid package. */
    detailMediaSectionPolaroid: 'Polaroids',
    detailNoPortfolioImages: 'No portfolio images',
    detailNoPolaroidImages: 'No polaroid images',
    /** Gallery detail viewer — back to grid */
    backToGallery: 'Back',
    /** Empty package / project gallery grid — not the Discover "no filters" empty state */
    galleryEmptySelection: 'No models in this selection yet.',
    /** Compact inseam fragment on gallery tiles (optional fourth measurement). */
    detailMeasurementInseam: 'Inseam',
    /** Primary CTA to open the existing option date picker (no inline date pills). */
    openOptionPicker: 'Option',
    /** Local-only gallery favorite toggle (accessibility label). */
    toggleFavoriteA11y: 'Mark as favorite',
    toggleUnfavoriteA11y: 'Remove favorite',
    /** Section label when browsing a saved project in Discover. */
    viewingProject: 'Selection',
    /** Gallery tile + detail — add model to a client project (same label in grid and modal). */
    addToSelection: 'Add to selection',
    addingToSelection: 'Adding…',
    /** When project title is missing in selection gallery header. */
    sharedProjectNameFallback: 'Project',
    /** Detail modal — calendar availability section label. */
    detailSectionCalendar: 'Calendar',
    /** Detail modal — option request section label. */
    detailSectionRequestOption: 'Request option',
    /** Detail modal — option request section helper text. */
    detailRequestOptionHelper: 'Request option for a specific date.',
  },
  /** Client Projects tab — project management actions. */
  projects: {
    deleteConfirm: 'Delete this project? All models will be removed from it.',
    /** Shown when the user taps Create without entering a project name. */
    createNameRequired: 'Enter a project name first.',
    /** Create button label while the project row is being saved. */
    creatingProject: 'Creating…',
    open: 'Open',
    /** Opens project folder (model list); Discover is a second step from the folder. */
    overview: 'Overview',
    /** Primary action inside project folder — opens this project's models in Discover swipe. */
    browseInDiscover: 'Browse in Discover',
    overviewTitle: 'Project Overview',
    deleteFromProject: 'Delete from Project',
    deleteFromProjectConfirm: 'Remove this model from the project?',
    emptyOverview: 'No models in this project yet.',
    removeError: 'Could not remove model. Please try again.',
    back: '← Back',
    /** Legacy key; RPC no longer requires client_agency_connections — kept for stable imports. */
    addToProjectNoConnection: 'Could not save the model to this project. Please try again.',
    addToProjectWrongOrg:
      'Could not add this model — this project belongs to a different organization.',
    addToProjectNotOrgMember:
      'Could not add this model — you are not a member of the selected client organization.',
    addToProjectNoClientOrg:
      'Could not add this model — no client organization is associated with your account.',
    addToProjectModelNoAgency: 'Could not add this model — profile data is incomplete (no agency).',
    addToProjectGeneric: 'Could not save the model to this project. Please try again.',
    /** Soft-error shown when fetching the latest projects from the server fails (offline / RLS / transient). */
    syncFailed: 'Could not refresh projects from server. Showing the last known state.',
  },
  /** Agency — model profile completeness alerts shown in the My Models edit panel. */
  modelCompleteness: {
    bannerTitle: 'Profile Incomplete',
    bannerSubtitle:
      'This model is visible in My Models and packages, but some required or recommended fields are missing.',
    bannerAllGood: 'Profile complete — no issues found.',
    severityCritical: 'Required',
    severityRecommended: 'Recommended',
    issueName: 'Name is missing — required for all views.',
    issuePhoto: 'No visible portfolio photo — clients cannot see this model.',
    issueTerritory:
      'No territory assigned — model will not appear in location-based client discovery.',
    issueVisibility:
      'Not visible to any client type. Assign at least one category or remove all to show in both.',
    issueHeight: 'Height missing — model excluded from height-based client filters.',
    issueCountry: 'No home country set — model appears via territory only.',
    issueEmail: 'No email — cannot link model app account (calendar, options, chats).',
    issueChest: 'Chest measurement missing.',
    issueWaist: 'Waist measurement missing.',
    issueHips: 'Hips measurement missing.',
    issueHairColor: 'Hair color not set.',
    issueEyeColor: 'Eye color not set.',
    issueSex: 'Sex not specified — affects sex-based client filters.',
    issueEthnicity: 'Ethnicity not specified — affects diversity filters.',
  },
  /** Client / Agency model discovery filters (ModelFiltersPanel). */
  filters: {
    triggerLabel: 'Filter',
    triggerLabelWithCount: (n: number) => `Filter (${n})`,
    sectionSex: 'Sex',
    sexAll: 'All',
    sexFemale: 'Female',
    sexMale: 'Male',
    sectionHeight: 'Height (cm)',
    heightFromPlaceholder: 'From',
    heightToPlaceholder: 'To',
    sectionEthnicity: 'Ethnicity',
    ethnicitySelected: (n: number) => `${n} selected`,
    ethnicityPlaceholder: 'Select ethnicity',
    sectionCategory: 'Category',
    categoryAll: 'All',
    sectionCountry: 'Country',
    countryChangePill: 'Change',
    nearMeLabel: 'Near me',
    nearMeLabelWithCity: (city: string) => `Near me (${city})`,
    countrySearchPlaceholder: 'Search country…',
    sectionCity: 'City',
    cityPlaceholder: 'e.g. Berlin, Hamburg, Munich...',
    cityPriorityHint:
      'Models in this city appear first, followed by all models in the selected country.',
    sectionHairColor: 'Hair color',
    hairColorPlaceholder: 'e.g. Brown, Blonde…',
    sectionHips: 'Hips (min–max)',
    sectionWaist: 'Waist (min–max)',
    sectionChest: 'Chest (cm, min–max)',
    sectionLegsInseam: 'Legs inseam (min–max)',
    measurementMin: 'min',
    measurementMax: 'max',
    saveFilters: 'Save filters',
    saveFiltersSaving: 'Saving…',
    saveFiltersSaved: '✓ Filters saved',
    saveFiltersError: 'Save failed — retry',
    resetFilters: 'Reset',
  },
  guestFlow: {
    /** Shown at the top of GuestView to clearly communicate limited access. */
    guestAccessBadge: 'Guest Access',
    guestAccessSubtitle:
      'You are viewing a shared package as a guest. Create an account for full booking access.',
    /** Hardcoded strings moved to uiCopy */
    invalidOrExpired: 'This link is invalid or has expired.',
    loadError: 'Could not load the package. Please try again.',
    /** get_guest_link_models failed while link metadata was valid */
    modelsLoadFailed:
      'Could not load models for this package. Check your connection and try again.',
    loading: 'Loading…',
    legalTitle: 'Before you continue',
    /** Legal gate body: use {agencyName} placeholder or empty for generic copy. */
    legalPackageIntro:
      '{agencyName} has shared a selection of models with you. Please accept the terms to continue.',
    legalPackageIntroFallbackAgency: 'An agency',
    legalTosLabel: 'I accept the Terms of Service',
    legalPrivacyLabel: 'I accept the Privacy Policy',
    legalContinue: 'View Models',
    browseTitle: 'Model Package',
    browseSendRequest: 'Send a Request to',
    /** Second action in the Browse-phase contact bar — navigates to full account signup. */
    browseCreateAccount: 'Create a free account',
    requestTitle: 'Send a Request',
    banner: 'You are using limited access. Create an account to unlock full features.',
    upgradeButton: 'Get full access',
    upgradeTitle: 'Upgrade to full access',
    upgradeCompanyPlaceholder: 'Company name (optional)',
    upgradeConfirm: 'Create account',
    upgradeCancelled: 'Upgrade cancelled.',
    upgradeError: 'Could not complete upgrade. Please try again.',
    checkEmail: 'Check your email',
    checkEmailSubtitle: 'We sent you a magic link. Click it to continue your request.',
    requestSent: 'Request sent',
    requestSentSubtitle: 'The agency will get back to you shortly.',
    selectModels: 'Select models for your request',
    requestFormSelectHintEmpty: 'Tap a model to select or deselect.',
    requestFormSelectHintCount: '{count} model(s) selected',
    invalidEmail: 'Please enter a valid email address.',
    dateLabel: 'Preferred date',
    datePlaceholderOptional: 'YYYY-MM-DD (optional)',
    messageLabelInput: 'Your message',
    messagePlaceholderProject: 'Tell the agency about your project…',
    submitRequestLegalNote:
      'By submitting, you agree that your email and request will be shared with {agencyName}.',
    submitRequestAgencyFallback: 'the agency',
    packageTypePolaroidLabel: 'Polaroid Package',
    packageTypePortfolioLabel: 'Portfolio Package',
    browseHeaderAgencyFallback: 'Organization',
    modelsCountInHeader: '{count} models',
    backToModels: '← Back to models',
    sexFemale: 'Female',
    sexMale: 'Male',
    checkEmailSentToPrefix: 'We sent a link to',
    checkEmailBackToModels: 'Back to models',
    checkEmailResend: 'Resend email',
    submitRequest: 'Send Request',
    emailLabel: 'Your email address',
    emailPlaceholder: 'you@example.com',
    submitting: 'Sending…',
    chatTitle: 'Guest Chat',
    noConversationHint: 'No active conversation found. Open a guest link to start a request.',
    upgradeModalBody:
      'Create a free client account to unlock model discovery, projects, and team management.',
    selectedModels: 'Selected models',
    noModelsSelected: 'No models selected.',
    noModelsInPackage: 'This package does not contain any models.',
    agencyLabel: 'Agency',
    guestClientLabel: 'Guest Client',
    loadingChat: 'Loading chat…',
    chatError: 'Could not load chat. Please try again.',
    agencyWorkspaceNotFound:
      'Could not find the agency workspace. Please contact the agency directly.',
    /** Gallery detail action buttons (guest must sign up first to actually use them). */
    galleryActionChat: 'Chat with Agency',
    galleryActionOption: 'Option',
    galleryActionAdd: 'Add to selection',
    /** Sign-up gate prompt shown when an unauthenticated guest taps an action. */
    signupGatePromptTitle: 'Create a free account',
    signupGatePromptBody:
      'Sign up to chat with the agency, send option requests, and add models to your selection. We will bring you back to this package right after.',
    signupGateContinue: 'Sign up to continue',
    signupGateCancel: 'Cancel',
  },
  /** Model – "My Applications" view status labels and feedback strings. */
  modelApplications: {
    statusPending: 'Pending',
    statusRepresentationRequest: 'Representation request',
    statusAccepted: 'Accepted',
    /** Recruiting: agency ended representation; row is not an active acceptance. */
    statusRepresentationEnded: 'Representation ended',
    statusDeclined: 'Declined',
    deleteFailedTitle: 'Could not delete',
    deleteFailedBody: 'Please try again or check your connection.',
    tab_applications: 'Applications',
    tab_messages: 'Messages',
    tab_settings: 'Settings',
    emptyState: 'No applications yet.',
    loadErrorState: 'Could not load applications. Please check your connection and try again.',
    loadingApplications: 'Loading applications…',
    deleteConfirmTitle: 'Delete application',
    deleteConfirmBody:
      'Are you sure you want to delete this application? This action cannot be undone.',
    deleteConfirmAction: 'Delete',
    confirmRepresentationError: 'Could not confirm representation. Please try again.',
    declineRepresentationError: 'Could not decline representation. Please try again.',
  },
  /** Agency – Recruiting view feedback strings. */
  agencyRecruiting: {
    acceptSuccessHint: 'Model accepted. Open the thread under Messages → Recruiting chats.',
    acceptFailHint: 'Could not accept application. Please try again.',
    rejectSuccessHint: 'Application declined.',
    rejectFailHint: 'Could not decline application. Please try again.',
    representationRequestSent: 'Representation request sent to the model.',
  },
  /** Notification bell + list */
  notifications: {
    title: 'Notifications',
    markAsRead: 'Mark as read',
    markAllRead: 'Mark all as read',
    empty: 'No new notifications',
    loading: 'Loading notifications…',
    newMessage: {
      title: 'New message',
      message: 'You have a new message.',
    },
    bookingAccepted: {
      title: 'Booking accepted',
      message: 'A booking has been accepted.',
    },
    modelConfirmed: {
      title: 'Model confirmed',
      message: 'A model has confirmed the booking.',
    },
    newOptionRequest: {
      title: 'New request',
      message: 'A new option/job request has arrived.',
    },
    awaitingModelConfirmation: {
      title: 'Awaiting confirmation',
      message: 'The model needs to confirm this booking.',
    },
    agencyCounterOffer: {
      title: 'Counter offer received',
      message: 'The agency has proposed a different fee. Please review and respond.',
    },
    jobConfirmed: {
      title: 'Job confirmed',
      message: 'The client has confirmed this option as a job.',
    },
    clientRejectedCounter: {
      title: 'Counter offer declined',
      message: 'The client has declined the counter offer.',
    },
    newOptionMessage: {
      title: 'New message on request',
      message: 'A new message has been added to an option/job request.',
    },
    newRecruitingMessage: {
      title: 'New recruiting message',
      message: 'You have a new message in your recruiting chat.',
    },
    requestRejectedByAgency: {
      title: 'Request declined',
      message: 'The agency has declined your option/job request.',
    },
    requestRejectedByModel: {
      title: 'Model declined',
      message: 'The model has declined the option/job request.',
    },
    applicationReceived: {
      title: 'New application',
      message: 'A new model application has been received.',
    },
    applicationAccepted: {
      title: 'Representation request',
      message: 'An agency wants to represent you. Please review and confirm.',
    },
    applicationRejected: {
      title: 'Application declined',
      message: 'Your application has been declined.',
    },
    applicationModelConfirmed: {
      title: 'Model confirmed representation',
      message: 'The model accepted your representation offer and is now in your roster.',
    },
  },
  systemMessages: {
    /** Centered workflow lines (`from_role = system`); not a participant chat message. */
    systemMessageLabel: 'System',
    agencyConfirmedAvailability: 'Agency confirmed availability for this option.',
    agencyAcceptedPrice: 'Agency accepted the proposed fee.',
    agencyDeclinedPrice: 'Agency declined the proposed fee. A counter offer can be sent below.',
    agencyCounterOffer: (price: number, currency: string) =>
      `Agency proposed ${price} ${currency}.`,
    clientAcceptedCounter: 'Client accepted the agency proposal.',
    clientRejectedCounter:
      'Client declined the counter offer. The agency can send a new counter offer.',
    jobConfirmedByClient: 'Job confirmed by client.',
    jobConfirmedByAgency: 'Job confirmed by agency.',
    /** Agency-facing kind `no_model_account` in SQL RPC — persisted as from_role=system only. */
    noModelAccount:
      'No model app account on file — you can negotiate and confirm with the client without waiting for model approval. The booking will appear in client and agency calendars when confirmed.',
    /** Kind `no_model_account_client_notice`: `insert_option_request_system_message` → from_role=system (not a client chat line). */
    noModelAccountClientNotice:
      'No model app account on file. The agency can negotiate and confirm with you without waiting for model approval. When confirmed, the booking appears in both calendars.',
    modelApprovedBooking: '✓ Approved by Model',
    modelDeclinedAvailability: 'Model declined the availability request.',
  },
  /** Option/casting negotiation thread — fullscreen chat chrome (client + agency). */
  optionNegotiationChat: {
    back: 'Back',
    confirmOption: 'Confirm availability',
    acceptProposedFee: 'Accept proposed fee',
    counterOffer: 'Make counter offer',
    rejectOption: 'Remove request',
    /** Agency: counter while client proposed price is still pending */
    counterOfferPendingHint:
      'Enter a counter-offer to send to the client (their proposed fee stays visible until they respond).',
    messagePlaceholder: 'Message…',
    send: 'Send',
    rejectOptionTitle: 'Remove this request?',
    rejectOptionMessage:
      'This permanently removes the option or casting for all parties before the job is confirmed. Calendars and threads will be cleared. This cannot be undone.',
    rejectOptionFailedTitle: 'Could not remove request',
    rejectOptionFailedMessage: 'The request may have already changed. Please reload and try again.',
    /** Model — Profile → Options booking requests */
    modelConfirmAvailabilityTitle: 'Confirm availability?',
    modelConfirmAvailabilityMessage:
      'You confirm you are available for this booking request. The agency and client will be notified.',
    modelDeclineAvailabilityTitle: 'Decline this request?',
    modelDeclineAvailabilityMessage:
      'You decline this booking request. The agency and client will be notified.',
    modelDeclineAvailabilityConfirm: 'Decline',
    counterPlaceholder: 'Amount (e.g. 3000)',
    proposeFeeHint: 'Propose a fee (optional)',
    sendOffer: 'Send offer',
    sendCounter: 'Send counter-offer',
    declineProposedFee: 'Decline proposed fee',
    hideActions: 'Hide actions',
    showActions: 'Actions',
    clientPriceDeclinedCounterHint: 'Client price declined — enter a counter-offer',
    negotiationContext: 'Negotiation',
    proposedPriceLabel: 'Proposed price',
    counterPriceLabel: 'Counter',
    /** Shown when client_price_status is accepted and option/job is confirmed — canonical agreed fee. */
    agreedPriceLabel: 'Agreed price',
    /**
     * @deprecated Misleading order (agency confirms availability first). Use
     * agencyConfirmAvailabilityBeforeModelStep / agencyWaitingForModelAfterAvailability instead.
     */
    modelMustPreApproveBeforeAgencyActs:
      'Waiting for the model to confirm availability in the model app. You can still negotiate the fee independently.',
    /** Agency: linked model, agency has not confirmed availability yet — model confirms only after you accept. */
    agencyConfirmAvailabilityBeforeModelStep:
      'Confirm availability first. After you accept, the model will be asked to confirm in their app. You can negotiate the fee in parallel.',
    /** Agency: you already set availability to confirmed; model still pending in app. */
    agencyWaitingForModelAfterAvailability:
      'Waiting for the model to confirm in their app. You can still negotiate the fee with the client.',
    /** Agency: model pre-approved availability — price negotiation is enabled. */
    modelAvailabilityConfirmedHint:
      'Model availability confirmed — you can negotiate the fee with the client.',
    /** Agency: no linked model account — client/agency negotiation does not wait on model app approval. */
    noModelAppNegotiationHint:
      'No model app account on file — negotiate and confirm with the client; calendars sync when the option is confirmed.',
    clientAssignmentLabel: 'Client assignment',
    clientFlagLabel: 'Client flag',
    clientFlagNone: 'none',
    editLabel: 'Edit',
    acceptAgencyProposal: 'Accept agency proposal',
    rejectCounterOffer: 'Decline agency proposal',
    rejectCounterOfferTitle: 'Decline this proposal?',
    rejectCounterOfferMessage: 'The request will be closed. You can start a new request if needed.',
    rejectCounterOfferFailedTitle: 'Could not decline proposal',
    rejectCounterOfferFailedMessage:
      'The proposal may have already changed. Please reload and try again.',
    confirmJob: 'Confirm job',
    /** Model inbox: tap opens Profile → Options for this request. */
    modelInboxOpenInProfileHint: 'Open in Profile → Options',
    /** Client: no model app — agency finalizes with client only. */
    clientNoModelAppHint:
      'No model app on file — the agency can confirm the booking with you without a model app step.',
    /** Client: agency accepted; linked model must still confirm in-app. */
    clientWaitingForModelConfirm: 'Waiting for the model to confirm the booking in their app.',
    /** B2B thread: terminal — no further fee negotiation. */
    negotiationFeeClosedRejected: 'This request was rejected. Fee negotiation is closed.',
    negotiationFeeClosedJobConfirmed: 'Job confirmed. Fee negotiation is closed.',
    /** Agency: counter-offer RPC rejected because status is no longer in_negotiation
     * (typically the model already confirmed availability → status='confirmed'). */
    counterOfferFailedNotInNegotiation:
      'Could not send the counter-offer — this request is no longer in negotiation. The model may have already confirmed availability or the request was rejected. The view has been refreshed.',
    /**
     * Generic fail-closed message for negotiation actions whose RPC rejected
     * (e.g. status is no longer `in_negotiation`, model already confirmed/rejected,
     * client_price_status drifted, request was withdrawn). Surfaced when:
     *   - confirmAvailability / acceptClientPrice / rejectClientPrice
     *   - clientAcceptCounter / clientConfirmJob / agencyConfirmJobAgencyOnly
     * fails on either side. UI is refreshed before the alert fires so the next
     * action reflects the true server state.
     */
    negotiationActionFailedTitle: 'Could not complete this action',
    negotiationActionFailedMessage:
      'The booking state changed before the action reached the server (e.g. the request was rejected, the model confirmed, or the price was already accepted). The view has been refreshed — try again if needed.',
    /** Agency: client declined proposed fee — prompt to send another counter. */
    agencyNegotiationAfterClientDecline:
      'Client declined the proposed fee — you can send a new counter-offer below.',
    showDetails: 'Show details',
    hideDetails: 'Hide details',
    /**
     * Agency — short hint above fee actions.
     */
    agencyNegotiationFeeStepIntro:
      'Negotiate the fee: accept the proposed fee or enter a counter-offer below.',
    /** Agency: counter sent; client must accept or decline before another counter. */
    agencyCounterAwaitingClientResponse:
      'Your counter-offer is pending. Waiting for the client to accept or decline.',
  },
  modelMedia: {
    /** Alert title — image rights checkbox / confirm flow (portfolio, polaroids, agency add-model). */
    imageRightsRequiredTitle: 'Image Rights Required',
    holdRightsBeforeUpload:
      'Please confirm you hold all necessary rights and consents before uploading photos.',
    holdRightsBeforeAddUrl:
      'Please confirm you hold all necessary rights and consents before adding this photo.',
    /** Agency add-model form: inline feedback when checkbox not ticked. */
    addModelConfirmImageRightsFeedback:
      'Please confirm you have all image rights before uploading photos.',
    addModelAuthRequiredToUploadPhotos: 'Authentication required to upload photos.',
    addModelPartialPortfolioUploadFailed:
      'One or more portfolio photos could not be uploaded. Please try again in the model settings.',
    addModelPartialPolaroidUploadFailed:
      'One or more polaroid photos could not be uploaded. Please try again in the model settings.',
    addModelPartialUploadTitle: 'Upload Failed',
    /** DB row count after upsert did not match uploads — storage may have files but model_photos incomplete. */
    photoPersistFailedTitle: 'Could not save all photos',
    photoPersistPortfolioFailedBody:
      'Not all portfolio images were stored in the database. Open the model and upload again if photos are missing.',
    photoPersistPolaroidFailedBody:
      'Not all polaroid images were stored in the database. Open the model and upload again if photos are missing.',
    /** agency model_locations row (source=agency) failed; models.city/country may still be saved. */
    agencyLocationPersistFailedTitle: 'Map location not saved',
    agencyLocationPersistFailedBody:
      'Your profile fields were saved, but the map location row could not be stored. Near Me and radius discovery may be incomplete until you save location again.',
    agencyLocationPersistFailedShort: 'Map location may be incomplete.',
    /** Appended to add-model success feedback when any sub-step failed (photos or map location). */
    addModelPersistenceWarningSuffix: ' Some items may not have saved fully — see alerts.',
    addModelNoPortfolioUploadedBody:
      'No portfolio photos could be uploaded. Please try again via Edit.',
    portfolioTitle: 'Portfolio',
    portfolioHint: 'First image is used as the cover in discovery and packages.',
    polaroidsTitle: 'Polaroids',
    polaroidsHint: 'Optionally shown to clients when included in a package.',
    privateTitle: 'Internal Files (Agency Only)',
    privateSubtitle: 'Never visible to clients — stored in a private, encrypted folder.',
    uploadPhotos: 'Upload Images',
    uploading: 'Uploading…',
    noPhotos: 'No photos yet.',
    showToClients: 'Show to clients',
    coverLabel: 'Cover',
    setCover: 'Set as cover',
    confirmDeleteTitle: 'Delete Image',
    confirmDeleteMessage: 'Are you sure you want to delete this image? This cannot be undone.',
    deleteCancel: 'Cancel',
    deleteConfirm: 'Delete',
    uploadError: 'Upload failed. Please try again.',
    heicConversionFailed:
      'Could not convert this HEIC/HEIF image in the browser. Please export as JPEG or PNG and try again.',
    deleteError: 'Could not delete the image. Please try again.',
    toggleError: 'Could not update visibility. Please try again.',
    saveSuccess: 'Photos saved.',
    saveError: 'Could not save photos. Please try again.',
    orPasteUrl: 'Or paste image URL',
    addUrl: '+ Add URL',
    signInToUploadPhotos: 'Please sign in to upload photos.',
    signInToAddPhotos: 'Please sign in to add photos.',
    /** models.portfolio_images could not be updated — roster / clients may show no cover until fixed. */
    portfolioColumnSyncFailed:
      'Could not sync portfolio to the model profile (cover list). Photos are saved; try again or refresh the roster.',
    polaroidColumnSyncFailed:
      'Could not sync polaroids to the model profile. Polaroid rows are saved; try again or refresh.',
    /** Checkbox is per visit; server also requires a recent rights confirmation in the audit window. */
    imageRightsCheckboxSessionHint:
      'Check this each time you add uploads in this session. A confirmation is recorded when you upload.',
    imageRightsSessionActiveHint:
      'Image rights confirmed recently — you can upload without re-checking until the session window expires.',
    viewManage: 'Manage',
    viewGallery: 'Gallery',
    /** Action labels on internal/private files: promote a private file into a client-visible bucket. */
    movePrivateToPortfolio: '→ Portfolio',
    movePrivateToPolaroid: '→ Polaroid',
    movePhotoInProgress: 'Moving…',
    movePhotoFailed: 'Could not move this photo. Please try again.',
    /** Hint shown above the private/internal section when the agency is using a desktop browser
     *  that supports drag-and-drop, so they know they can drag files onto Portfolio / Polaroid. */
    privateDragHint:
      'Tip: drag an internal file onto the Portfolio or Polaroids section to make it client-visible.',
    /** Drop-zone overlay shown on Portfolio / Polaroid when an internal file is being dragged over. */
    dropToMoveToPortfolio: 'Drop to add to Portfolio',
    dropToMoveToPolaroid: 'Drop to add to Polaroids',
    /** External image source toggle (Mediaslide / Netwalk) — only visible when the model is paired. */
    photoSourceBannerTitle: 'Image source',
    photoSourceBannerSubtitle:
      'Choose where this model\u2019s portfolio images come from. Switching to Mediaslide or Netwalk replaces the cover and discovery images with the latest URLs synced from that system. You can switch back to your own uploads at any time.',
    photoSourceOwn: 'Use own images',
    photoSourceOwnHint: 'Cover and discovery use the photos you uploaded here.',
    photoSourceMediaslide: 'Use Mediaslide images',
    photoSourceMediaslideHint:
      'Cover and discovery follow the latest portfolio synced from Mediaslide.',
    photoSourceNetwalk: 'Use Netwalk images',
    photoSourceNetwalkHint: 'Cover and discovery follow the latest portfolio synced from Netwalk.',
    photoSourceUpdating: 'Saving\u2026',
    photoSourceSaveFailed: 'Could not change the image source. Please try again.',
    /** Warning when the chosen external system has no portfolio URLs synced yet. */
    photoSourceMissingExternal:
      'No images have been synced from this system yet. Run a sync from the Import section or upload your own images below.',
    /** Hint that own uploads remain reachable even when external is selected. */
    photoSourceManualStillAvailable:
      'Tip: Your own uploads stay here \u2014 add or remove them anytime, even while external images are active.',
  },
  swipe: {
    headerLabel: 'The Swipe',
    emptyTitle: 'No results',
    emptyCopy: 'Adjust filters to see available talent.',
    skipAction: 'Skip',
    optionAction: 'Option',
    optionSending: 'Sending…',
    optionSuccessMessage: (date: string) => `Option sent for ${date}.`,
    filterButton: 'Filter',
    filterDrawerTitle: 'Filters',
    filterHeight: 'Height',
    filterCity: 'City',
    filterHair: 'Hair',
    filterAll: 'All',
    filterClear: 'Clear filters',
    detailClose: 'Close',
    detailVideoLabel: 'Video',
    detailVideoPlaceholder: 'Video placeholder',
    sendOptionTitle: 'Send option',
    sendOptionSubtitle: 'Choose a preferred date for the option.',
    measurementHeight: 'Height (cm)',
    measurementChest: 'Chest (cm)',
    measurementWaist: 'Waist (cm)',
    measurementHips: 'Hips (cm)',
  },
  validation: {
    messageTooLong: 'Message is too long (max 2000 characters).',
    messageEmpty: 'Message cannot be empty.',
    unsafeUrl: 'Only HTTPS links are allowed.',
    blockedProtocol: 'This link type is not allowed for security reasons.',
    fileTooLarge: 'File is too large. Maximum size is 200 MB.',
    fileTypeNotAllowed:
      'This file type is not allowed. Please upload an image (JPEG, PNG, WebP) or PDF.',
    fileContentMismatch: 'File content does not match its type. Renamed files are not allowed.',
    fileEmpty: 'The selected file is empty.',
    rateLimitMessages: 'You are sending messages too quickly. Please wait a moment.',
    rateLimitUploads: 'Too many uploads. Please wait before uploading again.',
    uploadFailed: 'Upload failed. Please try again.',
    genericValidationError: 'Your input could not be processed. Please check and try again.',
  },
  messenger: {
    sendFailed: 'Could not send message. Please try again.',
    loadFailed: 'Could not load messages. Please refresh.',
  },
  legal: {
    title: 'Terms & Conditions',
    subtitle: 'Please accept the following to continue using the platform.',
    tosLabel: 'Terms of Service',
    tosCheckLabel: 'I accept the',
    privacyLabel: 'Privacy Policy',
    trustLabel: 'Trust',
    statusLabel: 'Status',
    privacyCheckLabel: 'I accept the',
    privacySuffix: '(GDPR compliant)',
    agencyRightsLabel:
      'I confirm that I hold all necessary rights to use and share the personal data of the models I represent.',
    acceptButton: 'Accept & Continue',
    logoutButton: 'Logout',
    // URLs — update these to point to your hosted legal pages
    tosUrl: 'https://indexcasting.com/terms',
    privacyUrl: 'https://indexcasting.com/privacy',
    /** Canonical public Trust Center (same path as in-app /trust on web). */
    trustUrl: 'https://indexcasting.com/trust',
    /** Canonical public system status (same path as in-app /status on web). */
    statusUrl: 'https://indexcasting.com/status',
    // In-app screens
    termsScreenTitle: 'Terms of Service',
    privacyScreenTitle: 'Privacy Policy',
    legalScreenClose: 'Close',
    legalContactHint: 'For questions about this document, contact us at',
    legalContactEmail: 'legal@indexcasting.com',
    legalPendingTitle: 'Document coming soon',
    legalPendingBody:
      'The full legal text for this document will be published at launch. ' +
      'Please contact us if you need the current version before then.',
    /** In-app Privacy Policy — Art. 15 / 20: full export vs calendar sync subset. */
    privacyCalendarAccessNote:
      'Access and portability: your complete structured copy is available via “Download my data” (JSON). Calendar download (.ics) and subscription links sync a subset of your in-app calendar and are not a substitute for that full export.',
    /** Required checkbox before chat/recruiting file attachments (non-model portfolio). */
    chatFileRightsCheckbox: 'I confirm I have all necessary rights and consents for this upload.',
    chatFileRightsMissing:
      'Please confirm you have all necessary rights and consents for this upload.',
    /** DB / network failure after checkbox tick — same as model media panel. */
    imageRightsConfirmationFailed: 'Rights confirmation could not be recorded. Please try again.',
    /** Recent confirmation row missing or not readable — guard before upload. */
    imageRightsGuardVerificationFailed:
      'Rights confirmation could not be verified. Please try again.',
  },
  storage: {
    title: 'Storage',
    used: 'Storage Used',
    of: 'of',
    loadError: 'Could not load storage usage.',
    limitReached: 'Storage limit reached.',
    limitReachedDetail: 'Please delete files or contact support to upgrade.',
    warning80: 'You are using over 80% of your storage.',
    warning95: 'Almost full! You are using over 95% of your storage.',
    deleteChatFiles: 'Delete all media in this chat',
    deletePortfolioFiles: 'Delete all portfolio images',
    confirmDeleteChatFiles:
      'This will permanently delete all files in this chat thread. This cannot be undone.',
    confirmDeletePortfolio:
      'This will permanently delete all portfolio images for this model. This cannot be undone.',
    deleteSuccess: 'Files deleted successfully.',
    deleteError: 'Could not delete files. Please try again.',
    // Admin storage override
    unlimitedStorage: 'Unlimited Storage',
    storageLimitTitle: 'Storage Limit',
    storageLimitUsed: 'Used',
    storageLimitEffective: 'Effective Limit',
    storageLimitCustom: 'Custom',
    storageLimitUnlimited: 'Unlimited',
    storageLimitDefault: 'Default (5 GB)',
    storageLimitSetCustom: 'Set Limit',
    storageLimitSetUnlimited: 'Set Unlimited',
    storageLimitReset: 'Reset to Default',
    storageLimitSaveSuccess: 'Storage limit updated.',
    storageLimitSaveFailed: 'Could not update storage limit.',
    storageLimitResetSuccess: 'Storage limit reset to default.',
    storageLimitResetFailed: 'Could not reset storage limit.',
    storageLimitUnlimitedSuccess: 'Organization set to unlimited storage.',
    storageLimitUnlimitedFailed: 'Could not set unlimited storage.',
    storageLimitInputPlaceholder: 'Limit in GB (e.g. 20)',
    storageLimitConfirmUnlimited:
      'Grant this organization unlimited storage? This removes all upload restrictions.',
    storageLimitConfirmReset: 'Reset this organization to the default 5 GB storage limit?',
    storageLimitValidationNegative: 'Limit must be greater than 0 GB.',
    storageLimitValidationTooLarge: 'Limit cannot exceed 1024 GB (1 TB).',
  },

  pendingActivation: {
    brand: 'INDEX CASTING',
    title: 'Account Pending Activation',
    bodyPending:
      'Your account needs to be verified before you can access the platform. Please send your verification documents to the app operator.',
    agencyHint:
      'Agency accounts must register with the email address listed on your company website.',
    sendDocumentsBtn: 'Send Verification Documents via Email',
    bodySent:
      'Thank you! Your documents have been submitted. The app operator will review and activate your account shortly. You will receive an email confirmation.',
    checkStatusBtn: 'Check Activation Status',
    logoutBtn: 'Logout',
    emailSubject: (name: string) => `Account Verification – ${name}`,
    emailBody: (params: {
      orgKind: 'Agency' | 'Client';
      email: string;
      displayName: string;
      company: string;
    }) =>
      `Hello Casting Index Team,\n\n` +
      `I would like to activate my ${params.orgKind} account.\n\n` +
      `Account Email: ${params.email}\n` +
      `Display Name: ${params.displayName}\n` +
      `Company: ${params.company}\n\n` +
      `I have attached the required verification documents.\n\n` +
      `Best regards`,
    fallbackUser: 'User',
    fallbackCompany: 'N/A',
  },

  billing: {
    // ── Paywall screen ──────────────────────────────────────────────────────
    paywallTitle: 'Choose Your Plan',
    paywallSubtitle: 'Unlock the full power of Index Casting',
    trialBadge: 'Free Trial',
    trialActive: 'Your free trial is active',
    trialDaysLeft: (days: number) => `${days} day${days === 1 ? '' : 's'} remaining`,
    trialExpiredTitle: 'Your trial has ended',
    trialExpiredBody: 'Choose a plan to continue using Index Casting.',
    trialAlreadyUsedTitle: 'Trial not available',
    trialAlreadyUsedBody:
      'A free trial has already been used with this email address. Please subscribe to continue.',
    accessBlocked: 'Your account is currently inactive.',
    accessBlockedBody: 'Please subscribe to regain access.',

    // ── Plans ───────────────────────────────────────────────────────────────
    planNameAgencyBasic: 'Agency Basic',
    planNameAgencyPro: 'Agency Pro',
    planNameAgencyEnterprise: 'Agency Enterprise',
    planNameClient: 'Client',
    planNameAdmin: 'Admin Access',
    planNameTrial: 'Free Trial',

    // ── Feature limits ──────────────────────────────────────────────────────
    swipesPerDay: (n: number) => `${n} swipes / day`,
    swipesUnlimited: 'Unlimited swipes',
    storageLimit: (gb: number) => `${gb} GB storage`,
    storageUnlimited: 'Unlimited storage',
    fullPlatformAccess: 'Full platform access',
    realtimeMessaging: 'Real-time messaging',
    castingManagement: 'Casting management',
    agencyTeamSeats: (n: number) => `Up to ${n} team members (owner + bookers)`,
    agencyTeamSeatsUnlimited: 'Team members: unlimited or custom (Enterprise)',

    // ── CTAs ────────────────────────────────────────────────────────────────
    upgradeCTA: 'Get Started',
    upgradeNow: 'Upgrade Now',
    manageSubscription: 'Manage Subscription',
    continueFreeTrial: 'Continue Free Trial',
    contactSales: 'Contact Sales',

    // ── Status labels ───────────────────────────────────────────────────────
    statusActive: 'Active',
    statusTrialing: 'Trial',
    statusPastDue: 'Past Due',
    statusCanceled: 'Canceled',
    statusAdminAccess: 'Admin Override',

    // ── Admin billing panel ─────────────────────────────────────────────────
    adminBillingTitle: 'Billing & Subscription',
    adminBypassPaywall: 'Bypass Paywall',
    adminBypassPaywallOn: 'Full access enabled (no payment required)',
    adminBypassPaywallOff: 'Normal billing rules apply',
    adminCustomPlan: 'Custom Plan',
    adminCustomPlanPlaceholder: 'e.g. agency_pro',
    adminSetPlan: 'Set Plan',
    adminSetPlanSuccess: 'Plan updated successfully.',
    adminSetPlanFailed: 'Could not update plan.',
    adminBypassSuccess: 'Paywall bypass updated.',
    adminBypassFailed: 'Could not update paywall bypass.',
    adminNoSubscription: 'No subscription record found.',
    adminSubscriptionStatus: 'Subscription Status',
    adminTrialEndsAt: 'Trial Ends',
    adminCurrentPeriodEnd: 'Billing Period End',
    adminStripeCustomer: 'Stripe Customer ID',
    adminStripeSubscription: 'Stripe Subscription ID',

    // ── Non-owner paywall notice ─────────────────────────────────────────────
    nonOwnerPaywallTitle: 'Subscription Required',
    nonOwnerPaywallBody:
      'Only your organization owner can manage and activate the subscription. Please contact them to upgrade.',

    // ── Paywall screen (no hardcoded English in component) ─────────────────
    paywallClientTitle: 'Activate Your Account',
    paywallClientSubtitle: 'Your free trial has ended. Subscribe to regain full platform access.',
    paywallClientLockedBody:
      'Your access is locked until you subscribe. No partial access is available.',
    planCardRecommendedBadge: 'RECOMMENDED',
    paywallEnterpriseFooterLead: 'Need a custom enterprise plan?',
    paywallClientSupportLead: 'Questions?',
    paywallContactSupport: 'Contact support',

    // ── Owner billing status (in-app; server truth from can_access_platform) ─
    ownerBillingCardTitle: 'Billing & plan',
    ownerBillingReadOnlyTitle: 'Billing',
    ownerBillingReadOnlyBody:
      'Only your organization owner can start checkout or change the subscription. Contact them for upgrades.',
    ownerBillingAccessLabel: 'Access',
    ownerBillingCurrentPlanLabel: 'Current plan',
    ownerBillingTrialEndsLabel: 'Trial ends',
    ownerBillingTrialDaysLeft: (days: number) =>
      `${days} day${days === 1 ? '' : 's'} left in your trial`,
    ownerBillingSubscriptionStatusLabel: 'Subscription status',
    ownerBillingBillingPeriodEndLabel: 'Current period ends',
    ownerBillingFeaturesTitle: 'What this plan includes',
    ownerBillingAgencyTeamNote:
      'Team size limits count everyone in your organization (owner + bookers). Upgrade here to invite more bookers. Only the owner manages billing; bookers use the product when the organization is active.',
    ownerBillingIncludedIntroTrial:
      'During the trial you have access with trial limits until the trial end date.',
    ownerBillingReasonLineAdminOverride:
      'Full access is enabled for your organization (administrative access).',
    ownerBillingReasonLineTrialActive: 'Your free trial is active.',
    ownerBillingReasonLineSubscriptionActive: 'Your subscription is active.',
    ownerBillingReasonLineNoSubscription:
      'There is no active subscription. Subscribe to restore access when the trial is over.',
    ownerBillingReasonLineTrialAlreadyUsed:
      'A trial was already used for this email. A paid subscription is required.',
    ownerBillingReasonLineNoOrg:
      'We could not verify billing access. Try again shortly or contact support.',
    ownerBillingNextStepTrial:
      'Next step: subscribe before the trial ends to keep uninterrupted access.',
    ownerBillingNextStepSubscribe: 'Next step: choose a plan and complete checkout.',
    ownerBillingUpgradeFromTrialCTA: 'Subscribe now',
    ownerBillingCheckoutReturnedSuccess: 'Checkout completed. Your access will update in a moment.',
    ownerBillingCheckoutReturnedCancel:
      'Checkout was closed before completing. You can try again when ready.',
    billingTestModeNotice:
      'Payments may run in Stripe test mode in this environment — no real charges.',
    billingPaymentsProcessedBy: 'Payments are processed securely by Stripe.',

    // ── Errors ──────────────────────────────────────────────────────────────
    checkoutFailed: 'Could not open checkout. Please try again.',
    checkoutLoading: 'Preparing checkout…',
    accessCheckFailed: 'Could not verify platform access. Please try again.',
    swipeLimitReached: 'Daily swipe limit reached. Upgrade your plan for more swipes.',
    storageLimitReached: 'Storage limit reached. Upgrade your plan for more storage.',
  },
  /** B2B billing prep — owner-only; not shown to models (see billing-payment-invariants). */
  billingSettings: {
    cardTitle: 'Invoice & billing details',
    intro:
      'Used to pre-fill future invoices between your organization and business partners. Only the organization owner can edit.',
    sectionAddresses: 'Billing identities',
    sectionDefaults: 'Invoice defaults',
    primaryBadge: 'Default',
    addAddress: 'Add another billing address',
    save: 'Save billing settings',
    saving: 'Saving…',
    saveSuccess: 'Billing settings saved.',
    saveFailed: 'Could not save billing settings. Try again.',
    loadFailed: 'Could not load billing settings.',
    deleteAddress: 'Remove',
    deleteConfirmTitle: 'Remove this billing address?',
    deleteConfirmMessage: 'This cannot be undone. You can add a new address later.',
    fieldLabel: 'Label',
    fieldLabelPlaceholder: 'e.g. Headquarters, Paris office',
    fieldBillingName: 'Legal billing name',
    fieldBillingNamePlaceholder: 'Registered company name',
    fieldAddress1: 'Address line 1',
    fieldAddress2: 'Address line 2',
    fieldCity: 'City',
    fieldPostalCode: 'Postal code',
    fieldState: 'State / region',
    fieldCountry: 'Country',
    fieldBillingEmail: 'Invoice email',
    fieldVatId: 'VAT ID',
    fieldTaxId: 'Tax ID',
    fieldIban: 'IBAN',
    fieldBic: 'BIC / SWIFT',
    fieldBankName: 'Bank name',
    fieldCommissionRate: 'Default commission rate (%)',
    fieldCommissionHint:
      'Pre-filled for agency fee lines on future invoices; editable per booking.',
    fieldTaxRate: 'Default tax rate (%)',
    fieldTaxHint: 'Informational default for your invoices; adjust per invoice when needed.',
    fieldCurrency: 'Default currency',
    fieldPaymentTerms: 'Payment terms (days)',
    fieldInvoicePrefix: 'Invoice number prefix',
    fieldInvoicePrefixPlaceholder: 'e.g. INV-2026-',
    fieldNotesTemplate: 'Default invoice notes',
    fieldNotesPlaceholder: 'Optional text appended to future invoices.',
    fieldReverseCharge: 'Reverse charge (EU B2B)',
    fieldReverseChargeHint: 'Informational flag for your workflow; does not replace tax advice.',
    setAsDefault: 'Use as default billing identity',
    additionalIdentities: 'Additional billing identities',
    readOnlyHint:
      'Read-only view. Only the organization owner can edit billing addresses and invoice defaults.',
  },
  // ── Invoices (B2B Stripe Invoicing) ────────────────────────────────────────
  invoices: {
    cardTitle: 'Invoices',
    cardTitleOutgoing: 'Outgoing invoices',
    cardTitleIncoming: 'Incoming invoices',
    intro:
      'Manage outgoing invoices to your business partners. Drafts are auto-created when a job is confirmed; you can edit and review before sending via Stripe.',
    introOutgoing:
      'Manage outgoing invoices to your business partners. Drafts are auto-created when a job is confirmed; you can edit and review before sending via Stripe.',
    introIncoming:
      'Invoices issued by your business partners and addressed to your organization. Status is updated automatically by Stripe webhooks.',
    ownerOnlyHint: 'Only the organization owner can create, edit, or send invoices.',
    tabDrafts: 'Drafts',
    tabSent: 'Sent',
    tabPaid: 'Paid',
    tabOverdue: 'Overdue',
    tabReceived: 'Received',
    emptyDrafts: 'No invoice drafts.',
    emptySent: 'No sent invoices.',
    emptyPaid: 'No paid invoices.',
    emptyOverdue: 'No overdue invoices.',
    emptyReceived: 'No invoices received.',
    loading: 'Loading invoices…',
    loadFailed: 'Could not load invoices.',
    listColInvoiceNo: 'Invoice #',
    listColRecipient: 'Recipient',
    listColAmount: 'Amount',
    listColStatus: 'Status',
    listColCreated: 'Created',
    listColDue: 'Due',
    statusDraft: 'Draft',
    statusPendingSend: 'Sending…',
    statusSent: 'Sent',
    statusPaid: 'Paid',
    statusOverdue: 'Overdue',
    statusVoid: 'Void',
    statusUncollectible: 'Uncollectible',
    typeAgencyToClient: 'Agency → Client',
    typePlatformToAgency: 'Platform commission',
    typePlatformToClient: 'Platform service',
    openDraft: 'Open draft',
    openInvoice: 'Open',
    viewHostedStripe: 'View Stripe invoice',
    viewPdf: 'Download PDF',
    createDraft: 'Create draft',
    createDraftTitle: 'New invoice draft',
    delete: 'Delete draft',
    deleteConfirmTitle: 'Delete this draft?',
    deleteConfirmMessage:
      'This draft will be permanently removed. You can create a new one anytime.',
    sendViaStripe: 'Send via Stripe',
    sendingViaStripe: 'Sending…',
    sendConfirmTitle: 'Send this invoice via Stripe?',
    sendConfirmMessage:
      'The invoice will be finalized in Stripe, the recipient will receive an email, and you cannot edit it afterwards.',
    sendSuccess: 'Invoice sent via Stripe.',
    sendFailed: 'Could not send invoice. Try again.',
    retrySend: 'Retry send',
    retrySendConfirmTitle: 'Retry sending this invoice?',
    retrySendConfirmMessage:
      'This invoice is stuck in “Sending…” after a previous attempt was interrupted. Retrying is safe — Stripe will not be charged twice.',
    // Phase E (2026-04-19): Email delivery as alternative to Stripe.
    sendViaEmail: 'Send via Email',
    sendingViaEmail: 'Sending email…',
    sendEmailModalTitle: 'Send invoice via Email',
    sendEmailModalIntro:
      'The invoice will be finalized (number assigned, snapshots locked) and dispatched as an HTML email. After this you cannot edit it anymore.',
    sendEmailRecipientLabel: 'Recipient email',
    sendEmailRecipientPlaceholder: 'name@company.com',
    sendEmailRecipientHint:
      'Defaults to the recipient billing profile email — override here if needed.',
    sendEmailCcLabel: 'Cc (comma-separated, optional)',
    sendEmailCcPlaceholder: 'accounting@you.com, ops@you.com',
    sendEmailSubjectLabel: 'Subject (optional)',
    sendEmailSubjectPlaceholder: 'Invoice {number} from {issuer}',
    sendEmailMessageLabel: 'Message (optional, shown above the invoice block)',
    sendEmailMessagePlaceholder: 'Dear {recipient}, please find attached…',
    sendEmailDispatch: 'Send email',
    sendEmailCancel: 'Cancel',
    sendEmailMissingRecipient:
      'No recipient email available. Add an email to the recipient billing profile or enter one here.',
    sendEmailInvalidRecipient: 'Recipient email is not a valid address.',
    sendEmailInvalidCc: 'One or more Cc addresses are invalid.',
    sendEmailSuccess: 'Invoice sent via email.',
    sendEmailFailed: 'Could not send the invoice email. Try again.',
    saveSuccess: 'Draft saved.',
    saveFailed: 'Could not save draft. Try again.',
    deleteSuccess: 'Draft deleted.',
    deleteFailed: 'Could not delete draft.',
    fieldRecipient: 'Recipient organization',
    fieldRecipientHint: 'Select the client / agency that will receive this invoice.',
    fieldRecipientPlaceholder: 'Search organization…',
    fieldRecipientPickAgain: 'Change recipient',
    fieldNotes: 'Notes (visible on invoice)',
    fieldNotesPlaceholder: 'Optional notes — appended to the Stripe invoice.',
    fieldDueDate: 'Due date',
    fieldDueDatePlaceholder: 'YYYY-MM-DD',
    fieldCurrency: 'Currency',
    fieldTaxRate: 'Tax rate (%)',
    fieldTaxMode: 'Tax mode',
    taxModeManual: 'Manual rate',
    taxModeStripeTax: 'Stripe Tax (auto)',
    fieldReverseCharge: 'Reverse charge (EU B2B)',
    fieldReverseChargeHint: 'Excludes manual tax; declare on the invoice as required.',
    sectionLineItems: 'Line items',
    addLineItem: 'Add line item',
    lineDescription: 'Description',
    lineQuantity: 'Quantity',
    lineUnit: 'Unit price',
    lineTotal: 'Total',
    removeLine: 'Remove',
    summarySubtotal: 'Subtotal',
    summaryTax: 'Tax',
    summaryTotal: 'Total',
    summaryReverseChargeNote: 'Reverse charge — VAT to be accounted for by the recipient.',
    invoiceNumberPending: 'Auto on send',
    backToList: 'Back to invoices',
    refresh: 'Refresh',
    notRecipientYet: 'Pick a recipient before sending.',
    noLineItemsYet: 'Add at least one line item before sending.',
    cantEditNonDraft: 'Sent invoices cannot be edited. Use Stripe for status updates.',
    /** Recipient column displays the recipient organization or "Internal" for settlements. */
    listColRecipientFallback: 'Internal',
    /** Manual invoice creation — Agency → Agency commission. */
    typeAgencyToAgency: 'Agency → Agency',
    /** Recipient type toggle in the draft editor. */
    recipientTypeLabel: 'Recipient type',
    recipientTypeClient: 'Client organization',
    recipientTypeAgency: 'Agency organization',
    /** Preset prefill picker (visible only when presets exist for the selected recipient). */
    presetPickerLabel: 'Apply billing preset',
    presetPickerNone: 'No preset (start blank)',
    presetPickerHint:
      'Optional: prefill recipient billing details, currency, tax, terms, and starter line items.',
    presetAppliedNotice: 'Preset applied — values can still be edited before saving.',
    /** Search + filter + pagination (InvoicesPanel). */
    searchPlaceholder: 'Search by number, recipient, or notes…',
    filterTypeLabel: 'Type',
    filterCurrencyLabel: 'Currency',
    filterAllTypes: 'All types',
    filterAllCurrencies: 'All currencies',
    filterClear: 'Clear filters',
    loadMore: 'Load more',
    loadingMore: 'Loading…',
    noMore: 'No more invoices.',
    yearGroupLabel: (year: number | string): string => `Year ${year}`,
    /** Shown when current search/filter combination matches no invoices. */
    emptyFiltered: 'No invoices match the current search or filters.',
  },

  // ── Billing Hub (new dedicated tab) ───────────────────────────────────────
  /**
   * Strings shown in the new Billing top-level tab. Wraps the existing
   * `invoices` and `billingSettings` blocks plus settlements and presets.
   * Owner-only writes; bookers / employees see read-only state.
   */
  billingHub: {
    tabLabel: 'Billing',
    headerTitle: 'Billing',
    headerSubtitleAgency:
      'Outgoing invoices, internal settlements, billing partners, and your billing identity.',
    headerSubtitleClient: 'Invoices addressed to your organization and your billing identity.',

    // Sub-tabs (Agency view)
    subTabOutgoing: 'Outgoing',
    subTabIncoming: 'Incoming',
    subTabSettlements: 'Model settlements',
    subTabPresets: 'Clients & presets',
    subTabProfiles: 'Org profiles',
    subTabDefaults: 'Defaults',

    // Sub-tabs (Client view)
    subTabReceived: 'Received',
    // (profiles + defaults reused)

    // Owner-gated banner for non-owner viewers (booker / employee)
    readOnlyBanner:
      'Read-only view. Only the organization owner can create, edit, or send billing items.',

    // Smart attention banner — shown when any visible signal exists
    attentionBannerTitle: 'Action required',
    attentionBannerSeverityCritical: 'Critical',
    attentionBannerSeverityHigh: 'High',
    attentionBannerSeverityMedium: 'Medium',
    attentionBannerSeverityLow: 'Reminder',
    attentionEmpty: 'Everything is up to date.',

    // Per-category copy (used in attention banner + dashboard widget)
    attentionCategoryInvoiceOverdue: 'Overdue invoice',
    attentionCategoryInvoiceUnpaid: 'Unpaid invoice',
    attentionCategoryInvoiceDraftPending: 'Draft to review',
    attentionCategoryInvoicePendingSend: 'Stuck in “Sending…”',
    attentionCategoryInvoicePaymentFailed: 'Payment failed',
    attentionCategoryInvoiceMissingRecipientData: 'Recipient data incomplete',
    attentionCategoryInvoiceReceivedUnpaid: 'Bill awaiting payment',
    attentionCategoryInvoiceReceivedOverdue: 'Bill overdue',
    attentionCategorySettlementDraftPending: 'Settlement draft',
    attentionCategorySettlementRecordedUnpaid: 'Settlement to pay out',
    attentionCategoryBillingProfileMissing: 'Billing profile incomplete',
    attentionCategoryBillingProfileMissingHint:
      'Add a billing identity so future invoices can be issued without delays.',

    // Search / filter / pagination (Outgoing & Incoming lists)
    searchPlaceholder: 'Search invoice #, recipient, or notes…',
    filterStatusLabel: 'Status',
    filterStatusAll: 'All statuses',
    filterTypeLabel: 'Type',
    filterTypeAll: 'All types',
    filterCurrencyLabel: 'Currency',
    filterCurrencyAll: 'All currencies',
    filterYearLabel: 'Year',
    filterYearAll: 'All years',
    filterClear: 'Clear filters',
    filterResultCount: (n: number) => `${n} invoice${n === 1 ? '' : 's'}`,
    paginationLoadMore: 'Load more',
    paginationLoading: 'Loading…',
    paginationEnd: 'No more results.',
    yearGroupLabel: (y: number) => `${y}`,

    // ── Manual Billing entry (separate sub-tab inside Billing) ─────────────
    subTabManualInvoices: 'Manual invoices',
  },

  /**
   * Manual Billing — separate sub-system inside the Billing tab.
   * Lets agencies manage their own legal entities, client/model billing
   * profiles, and create manual invoice PDFs (Agency→Client, Agency→Model,
   * Model→Agency). Strictly isolated from Stripe-routed invoices.
   * English-only by design.
   */
  manualBilling: {
    // Hub
    headerTitle: 'Manual invoices',
    headerSubtitle:
      'Manage your billing identities and create professional invoice PDFs. Independent from Stripe — you stay in control of every line.',
    backToBilling: 'Back to Billing',
    notAvailableForRole:
      'Only agency owners and bookers can manage manual invoices and billing profiles.',

    // Entry tiles
    tileProfilesTitle: 'Billing profiles',
    tileProfilesSubtitle:
      'Reusable identities for your agency, your clients, and your models. Used to pre-fill invoices.',
    tileCreateInvoiceTitle: 'Create invoice manually',
    tileCreateInvoiceSubtitle:
      'Build a professional invoice step by step. Pick sender + recipient, add line items, preview the PDF, then generate.',
    tileInvoicesTitle: 'Invoices & drafts',
    tileInvoicesSubtitle:
      'See drafts you started and invoices you generated. Re-open, re-export, or delete drafts.',
    countLabelProfiles: (n: number) => `${n} profile${n === 1 ? '' : 's'}`,
    countLabelInvoices: (n: number) => `${n} invoice${n === 1 ? '' : 's'}`,
    countLabelDrafts: (n: number) => `${n} draft${n === 1 ? '' : 's'}`,

    // Profiles section
    profilesScreenTitle: 'Billing profiles',
    profilesScreenSubtitle:
      'Reusable identities. Use them as sender or recipient when creating invoices.',
    profilesTabAgency: 'Agency profiles',
    profilesTabClients: 'Clients',
    profilesTabModels: 'Models',
    profilesSearchPlaceholder: 'Search by name, VAT ID, city, contact…',
    profilesEmptyAgency:
      'No agency profiles yet. Add your first legal entity (Ltd, GmbH, Kft.) to start invoicing.',
    profilesEmptyClients: 'No client profiles yet. Add a client to pre-fill its billing details.',
    profilesEmptyModels: 'No model profiles yet. Add one to invoice from or to a model.',
    profilesShowArchived: 'Show archived',
    profilesNew: 'New profile',
    profilesArchive: 'Archive',
    profilesRestore: 'Restore',
    profilesDelete: 'Delete',
    profilesDeleteConfirmTitle: 'Delete this profile?',
    profilesDeleteConfirmBody:
      'This is permanent. Already-generated invoices keep their frozen snapshot — they will not change.',
    profilesArchiveConfirmTitle: 'Archive this profile?',
    profilesArchiveConfirmBody:
      'Archived profiles stay available for old invoices but no longer appear in pickers.',
    profilesArchived: 'Archived',
    profilesDefaultBadge: 'Default',
    profilesReverseChargeBadge: 'Reverse charge',
    profilesEditTitle: 'Edit profile',
    profilesNewAgencyTitle: 'New agency profile',
    profilesNewClientTitle: 'New client profile',
    profilesNewModelTitle: 'New model profile',

    // Profile form fields
    fieldLegalName: 'Legal name',
    fieldLegalNameHint: 'Required. Appears on the invoice as the official party.',
    fieldTradingName: 'Trading / display name',
    fieldAddressLine1: 'Address line 1',
    fieldAddressLine2: 'Address line 2',
    fieldCity: 'City',
    fieldPostalCode: 'Postal code',
    fieldState: 'State / Region',
    fieldCountryCode: 'Country code',
    fieldCountryCodeHint: 'ISO-3166 (e.g. DE, GB, IT). Two letters.',
    fieldCompanyRegistration: 'Company registration #',
    fieldVatNumber: 'VAT ID',
    fieldTaxNumber: 'Tax number',
    fieldPhone: 'Phone',
    fieldEmail: 'Email',
    fieldWebsite: 'Website',
    fieldBankName: 'Bank name',
    fieldBankAddress: 'Bank address',
    fieldIban: 'IBAN',
    fieldBic: 'BIC / SWIFT',
    fieldAccountHolder: 'Account holder',
    fieldDefaultCurrency: 'Default currency',
    fieldDefaultPaymentTerms: 'Default payment terms (days)',
    fieldDefaultVatTreatment: 'Default VAT treatment',
    fieldVatTreatmentDomestic: 'Domestic VAT',
    fieldVatTreatmentReverseCharge: 'EU reverse charge',
    fieldVatTreatmentZeroRated: 'Zero-rated',
    fieldVatTreatmentExempt: 'Exempt',
    fieldVatTreatmentOutOfScope: 'No VAT / outside scope',
    fieldVatTreatmentCustom: 'Custom',
    fieldDefaultReverseChargeNote: 'Default reverse-charge note',
    fieldDefaultReverseChargeNoteHint:
      'Suggested wording: “This supply is subject to the Reverse Charge. Customer to account for VAT under Article 196 of EU Directive 2006/112/EC.”',
    fieldFooterNotes: 'Footer notes',
    fieldIsDefault: 'Use as default agency profile',
    fieldDisplayName: 'Display name',
    fieldContactPerson: 'Contact person',
    fieldBillingEmail: 'Billing email',
    fieldPoNumber: 'PO / buyer reference',
    fieldApContact: 'AP contact',
    fieldDefaultInvoiceNote: 'Default invoice note',
    fieldDefaultServiceChargePct: 'Default service charge (%)',
    fieldExpensesReimbursed: 'Reimburse expenses by default',
    fieldTravelSeparate: 'Show travel separately',
    fieldAgencyFeeSeparate: 'Show agency fee separately',
    fieldNotes: 'Internal notes',

    // Profile form actions / errors
    save: 'Save',
    saving: 'Saving…',
    cancel: 'Cancel',
    saveSuccess: 'Profile saved.',
    saveFailedLegalName: 'Legal name is required.',
    saveFailedGeneric: 'Could not save. Please try again.',
    archiveSuccess: 'Profile archived.',
    archiveFailed: 'Could not archive profile.',
    restoreSuccess: 'Profile restored.',
    restoreFailed: 'Could not restore profile.',
    deleteSuccess: 'Profile deleted.',
    deleteFailed: 'Could not delete profile.',
    unsavedChangesTitle: 'Discard unsaved changes?',
    unsavedChangesBody: 'Your edits will be lost.',

    // Invoice list
    invoicesScreenTitle: 'Invoices & drafts',
    invoicesScreenSubtitle:
      'Drafts can be edited and finalized. Generated invoices are frozen and downloadable as PDF.',
    invoicesEmpty: 'No manual invoices yet.',
    invoicesFilterAll: 'All',
    invoicesFilterDraft: 'Drafts',
    invoicesFilterGenerated: 'Generated',
    invoicesNew: 'New invoice',
    invoiceStatusDraft: 'Draft',
    invoiceStatusGenerated: 'Generated',
    invoiceStatusVoid: 'Void',
    invoiceDirectionAgencyClient: 'Agency → Client',
    invoiceDirectionAgencyModel: 'Agency → Model',
    invoiceDirectionModelAgency: 'Model → Agency',
    invoiceListColNumber: 'Invoice #',
    invoiceListColRecipient: 'To',
    invoiceListColTotal: 'Total',
    invoiceListColIssued: 'Issued',
    invoiceDeleteDraft: 'Delete draft',
    invoiceDeleteDraftConfirmTitle: 'Delete this draft?',
    invoiceDeleteDraftConfirmBody: 'Drafts are not yet legal documents — this is safe.',
    invoiceCannotDeleteGenerated:
      'Generated invoices cannot be deleted — only marked as void in a future release.',

    // Builder wizard
    builderTitle: 'Create invoice',
    builderEditTitle: 'Edit draft',
    builderProgress: (step: number, total: number) => `Step ${step} of ${total}`,
    builderNext: 'Next',
    builderBack: 'Back',
    builderSaveDraft: 'Save draft',
    builderGenerate: 'Generate invoice',
    builderPreview: 'Preview PDF',

    // Step 1 — direction
    step1Title: 'What kind of invoice?',
    step1Subtitle: 'Pick the direction. We adjust which profiles you can pick next.',
    step1OptionAgencyClient: 'Agency → Client',
    step1OptionAgencyClientHint:
      'Most common — your agency invoices a brand or production company.',
    step1OptionAgencyModel: 'Agency → Model',
    step1OptionAgencyModelHint: 'Pass through costs, fees, or services to a model.',
    step1OptionModelAgency: 'Model → Agency',
    step1OptionModelAgencyHint: 'A model invoices the agency (self-billing scenarios excluded).',

    // Step 2 — profiles
    step2Title: 'Sender and recipient',
    step2Subtitle: 'Pick the billing profiles. Fields will be filled in automatically.',
    step2SenderLabel: 'Sender',
    step2RecipientLabel: 'Recipient',
    step2PickAgencyProfile: 'Pick an agency profile',
    step2PickClientProfile: 'Pick a client profile',
    step2PickModelProfile: 'Pick a model profile',
    step2NoProfileSelected: 'No profile selected.',
    step2NoAgencyProfileFound:
      'No agency billing profiles found. Add one in Manual invoices → Billing profiles first.',
    step2CopyFromOrgProfile: 'Copy from Org profiles',
    step2CopyFromOrgProfileImporting: 'Copying…',
    step2CopyFromOrgProfileNoOrg:
      'No Org profile found. Add one under Billing → Org profiles first.',
    step2CopyFromOrgProfileNoName:
      'Your Org profile has no billing name set. Fill in the billing name under Billing → Org profiles first.',
    step2SearchPlaceholder: 'Search…',
    step2SortLabel: 'Sort:',
    step2SortAlpha: 'A–Z',
    step2SortModified: 'Recently modified',
    step2DefaultBadge: 'Default',
    step2NoSearchResults: (term: string) => `No results for "${term}"`,
    step2ShowingCount: (shown: number, total: number) => `Showing ${shown} of ${total}`,
    step2CreateProfileHint: 'Need a new profile? Cancel, open Billing profiles, then come back.',

    // Step 3 — metadata
    step3Title: 'Invoice details',
    step3Subtitle:
      'Number, dates, currency, references. We can suggest the next number — you decide.',
    step3InvoiceNumberLabel: 'Invoice number',
    step3InvoiceNumberPlaceholder: 'e.g. INV-2026-001',
    step3SuggestNumber: 'Suggest next',
    step3SuggestFailed: 'Could not suggest a number. Enter one manually.',
    step3IssueDateLabel: 'Issue date',
    step3SupplyDateLabel: 'Supply / performance date',
    step3DueDateLabel: 'Due date',
    step3PaymentTermsLabel: 'Payment terms (days)',
    step3CurrencyLabel: 'Currency',
    step3PoNumberLabel: 'PO / buyer reference',
    step3JobReferenceLabel: 'Job / project reference',
    step3BookingReferenceLabel: 'Booking reference',

    // Step 4 — line items
    step4Title: 'Line items',
    step4Subtitle: 'Add what is being billed. Live totals update on the right.',
    step4AddLine: 'Add line',
    step4AddExpense: 'Add expense',
    step4Duplicate: 'Duplicate',
    step4Remove: 'Remove',
    step4MoveUp: 'Move up',
    step4MoveDown: 'Move down',
    step4LineCategory: 'Category',
    step4LineDescription: 'Description',
    step4LineModelLabel: 'Model / person',
    step4LineJobLabel: 'Job / project',
    step4LinePerformedOn: 'Date',
    step4LineQuantity: 'Qty',
    step4LineUnit: 'Unit',
    step4LineUnitAmount: 'Unit price',
    step4LineTaxTreatment: 'Tax treatment',
    step4LineTaxRate: 'VAT %',
    step4LineNotes: 'Notes',
    step4Empty: 'No lines yet. Add at least one to continue.',
    step4CategoryDayRate: 'Day rate',
    step4CategoryHalfDay: 'Half day',
    step4CategoryFitting: 'Fitting',
    step4CategoryShowFee: 'Show fee',
    step4CategoryUsage: 'Usage / buyout',
    step4CategoryTravel: 'Travel',
    step4CategoryTaxi: 'Taxi',
    step4CategoryFlight: 'Flight',
    step4CategoryHotel: 'Hotel',
    step4CategoryPerDiem: 'Per diem',
    step4CategoryServiceCharge: 'Service / agency fee',
    step4CategoryProduction: 'Production cost',
    step4CategoryPhotography: 'Photography cost',
    step4CategoryCancellation: 'Cancellation fee',
    step4CategoryCustom: 'Custom',

    // Step 5 — totals & tax
    step5Title: 'Totals & tax notes',
    step5Subtitle:
      'Review the totals. Edit the tax note explicitly — we never apply a treatment silently.',
    step5SubtotalRates: 'Subtotal — rates',
    step5SubtotalExpenses: 'Subtotal — expenses',
    step5ServiceChargeLabel: 'Service charge / agency fee (%)',
    step5ServiceChargeAmount: 'Service charge amount',
    step5VatBreakdown: 'VAT breakdown',
    step5VatRow: (rate: number | null, treatment: string | null) =>
      `${rate == null ? '—' : `${rate}%`}${treatment ? ` (${treatment})` : ''}`,
    step5TaxTotal: 'Tax total',
    step5GrandTotal: 'Grand total',
    step5TaxNote: 'Tax note (printed on PDF)',
    step5InvoiceNotes: 'Invoice notes',
    step5PaymentInstructions: 'Payment instructions',
    step5FooterNotes: 'Footer',
    step5ReverseChargeWarning:
      'You marked this as Reverse Charge. Make sure the recipient is a VAT-registered business in another EU member state.',
    step5MultiCurrencyWarning:
      'Some line items use a different currency than the invoice header. The PDF will use the header currency for totals.',

    // Step 6 — preview
    step6Title: 'Preview',
    step6Subtitle: 'This is exactly what your client will see. Generate when you are ready.',
    step6PreviewLoading: 'Building preview…',
    step6PreviewFailed: 'Could not build preview. Please try again.',
    step6Download: 'Download PDF',
    step6NativePreviewUnavailable:
      'Embedded preview is not available on this device. Build the preview, then open or share the PDF file.',
    step6OpenPdf: 'Open / share PDF',
    step6OpenPdfFailed: 'Could not open or share the PDF. Please try again.',
    step6OpenInNewTab: 'Open in new tab',
    builderInvoiceLockedTitle: 'Invoice locked (generated)',
    builderInvoiceLockedBody:
      'This invoice is finalised. Edits are blocked in the database — only PDF export is available.',
    step6GenerateConfirmTitle: 'Generate this invoice?',
    step6GenerateConfirmBody:
      'Sender + recipient details will be frozen. The invoice number cannot be changed afterwards.',

    // Validation errors
    errorMissingSender: 'Pick a sender profile.',
    errorMissingRecipient: 'Pick a recipient profile.',
    errorMissingInvoiceNumber: 'Enter an invoice number.',
    errorInvoiceNumberTaken: 'This invoice number is already used in your agency.',
    errorNoLineItems: 'Add at least one line item.',
    errorLineMissingDescription: 'Each line item needs a description.',
    errorLineInvalidAmount: 'Each line item needs a unit price.',
    errorBuilderGenerationFailed: 'Could not generate the invoice. Please try again.',
    errorBuilderSaveFailed: 'Could not save the draft. Please try again.',
    errorBuilderNoOrgContext: 'No organisation context found. Please sign in again.',
    errorLoadFailed: 'Could not load. Please try again.',

    // Direction-validation reasons (mapped from service)
    reasonAgencyToClientSenderMustBeAgency:
      'Sender must be one of your agency profiles for Agency → Client.',
    reasonAgencyToClientRecipientMustBeCounterparty:
      'Recipient must be a client profile for Agency → Client.',
    reasonAgencyToModelSenderMustBeAgency:
      'Sender must be one of your agency profiles for Agency → Model.',
    reasonAgencyToModelRecipientMustBeCounterparty:
      'Recipient must be a model profile for Agency → Model.',
    reasonModelToAgencySenderMustBeCounterparty:
      'Sender must be a model profile for Model → Agency.',
    reasonModelToAgencyRecipientMustBeAgency:
      'Recipient must be one of your agency profiles for Model → Agency.',

    // PDF
    pdfTitle: (number: string) => `Invoice ${number}`,
    pdfSupplierLabel: 'Supplier',
    pdfBillToLabel: 'Bill to',
    pdfInvoiceLabel: 'Invoice',
    pdfInvoiceNumberLabel: 'Number',
    pdfIssueDateLabel: 'Issue date',
    pdfSupplyDateLabel: 'Supply date',
    pdfDueDateLabel: 'Due date',
    pdfPaymentTermsLabel: 'Payment terms',
    pdfCurrencyLabel: 'Currency',
    pdfPoLabel: 'PO / Reference',
    pdfJobLabel: 'Job',
    pdfBookingLabel: 'Booking',
    pdfBankDetailsLabel: 'Payment details',
    pdfBankAccountHolder: 'Account holder',
    pdfBankName: 'Bank',
    pdfIban: 'IBAN',
    pdfBic: 'BIC / SWIFT',
    pdfLineColDate: 'Date',
    pdfLineColDescription: 'Description',
    pdfLineColQty: 'Qty',
    pdfLineColUnit: 'Unit price',
    pdfLineColVat: 'VAT',
    pdfLineColAmount: 'Net',
    pdfTotalsSubtotalRates: 'Subtotal rates',
    pdfTotalsSubtotalExpenses: 'Subtotal expenses',
    pdfTotalsServiceCharge: 'Service charge',
    pdfTotalsVat: (rate: number | null, treatment: string | null) =>
      `VAT ${rate == null ? (treatment ?? '—') : `${rate}%${treatment ? ` (${treatment})` : ''}`}`,
    pdfTotalsTaxTotal: 'Tax total',
    pdfTotalsGrandTotal: 'Grand total',
    pdfTotalsAmountDue: 'Amount due',
    pdfTaxNoteLabel: 'Tax note',
    pdfNotesLabel: 'Notes',
    pdfPaymentInstructionsLabel: 'Payment',
    pdfPageLabel: (page: number, total: number) => `Page ${page} of ${total}`,
    pdfDraftWatermark: 'DRAFT',
    pdfFooterFallback: 'Generated with IndexCasting Manual Billing.',
  },

  // ── Agency ↔ Model internal settlements ───────────────────────────────────
  /** Agency-internal payout / commission tracking. Never shown to models or clients. */
  settlements: {
    cardTitle: 'Model settlements',
    intro:
      'Internal record of model payouts and commission. Visible only to your agency team — never to models or clients.',
    ownerOnlyHint: 'Only the organization owner can create or update settlements.',

    listColModel: 'Model',
    listColNumber: 'Settlement #',
    listColAmount: 'Net amount',
    listColStatus: 'Status',
    listColCreated: 'Created',
    listColPaidAt: 'Paid',
    statusDraft: 'Draft',
    statusRecorded: 'Recorded',
    statusPaid: 'Paid',
    statusVoid: 'Void',

    empty: 'No settlements yet.',
    loading: 'Loading settlements…',
    loadFailed: 'Could not load settlements.',

    create: 'New settlement',
    createTitle: 'New model settlement',
    delete: 'Delete draft',
    deleteConfirmTitle: 'Delete this draft settlement?',
    deleteConfirmMessage: 'Drafts can be removed. Recorded or paid settlements cannot be deleted.',
    deleteFailed: 'Could not delete settlement.',
    deleteSuccess: 'Draft removed.',

    save: 'Save',
    saveSuccess: 'Settlement saved.',
    saveFailed: 'Could not save settlement.',

    markRecorded: 'Mark as recorded',
    markRecordedConfirmTitle: 'Record this settlement?',
    markRecordedConfirmMessage:
      'Once recorded, this settlement is part of your agency-internal ledger. You can still mark it as paid later.',
    markRecordedFailed: 'Could not record settlement.',

    markPaid: 'Mark as paid',
    markPaidConfirmTitle: 'Mark settlement as paid?',
    markPaidConfirmMessage: 'Records the payout date for this model. This step is final.',
    markPaidFailed: 'Could not mark as paid.',
    markPaidSuccess: 'Settlement marked as paid.',

    markVoid: 'Void',
    markVoidConfirmTitle: 'Void this settlement?',
    markVoidConfirmMessage: 'Voided settlements remain in the ledger for audit.',

    fieldModel: 'Model',
    fieldModelPlaceholder: 'Search your roster…',
    fieldSettlementNumber: 'Settlement number',
    fieldSettlementNumberPlaceholder: 'Optional — your internal reference.',
    fieldGross: 'Gross amount',
    fieldCommission: 'Agency commission',
    fieldNet: 'Net to model',
    fieldCurrency: 'Currency',
    fieldNotes: 'Notes (internal)',
    fieldNotesPlaceholder: 'Optional — visible only to your agency team.',

    sectionItems: 'Line items',
    addItem: 'Add line',
    removeItem: 'Remove',
    itemDescription: 'Description',
    itemQuantity: 'Quantity',
    itemUnit: 'Unit amount',
    itemTotal: 'Total',

    backToList: 'Back to settlements',
  },

  // ── Agency × Client billing presets ───────────────────────────────────────
  /** Agency-side convenience templates per client. Never shown to clients or models. */
  billingPresets: {
    cardTitle: 'Clients & billing presets',
    intro:
      'Save reusable billing templates per client. Presets pre-fill new invoice drafts only — they never alter invoices already created.',
    ownerOnlyHint: 'Only the organization owner can create or edit presets.',

    listColClient: 'Client',
    listColPresetCount: 'Presets',
    listColDefault: 'Default preset',
    listColUpdated: 'Updated',
    listEmpty: 'No clients yet.',
    listEmptyHint: 'Presets appear here automatically once you start invoicing recurring clients.',

    presetListTitle: 'Presets',
    presetListEmpty: 'No presets for this client yet.',
    presetCreate: 'New preset',
    presetEdit: 'Edit preset',
    presetDelete: 'Delete preset',
    presetDeleteConfirmTitle: 'Delete this preset?',
    presetDeleteConfirmMessage:
      'Existing invoices are not affected — the immutable billing snapshot stays on each invoice.',
    presetDeleteFailed: 'Could not delete preset.',
    presetSetDefault: 'Set as default',
    presetIsDefault: 'Default',

    save: 'Save preset',
    saveSuccess: 'Preset saved.',
    saveFailed: 'Could not save preset.',

    fieldLabel: 'Preset label',
    fieldLabelPlaceholder: 'e.g. HQ — net 30',
    fieldRecipientName: 'Recipient legal name',
    fieldRecipientAddress1: 'Address line 1',
    fieldRecipientAddress2: 'Address line 2',
    fieldRecipientCity: 'City',
    fieldRecipientPostalCode: 'Postal code',
    fieldRecipientState: 'State / region',
    fieldRecipientCountry: 'Country',
    fieldRecipientEmail: 'Invoice email',
    fieldVatId: 'VAT ID',
    fieldTaxId: 'Tax ID',
    fieldCurrency: 'Default currency',
    fieldTaxMode: 'Tax mode',
    fieldTaxRate: 'Tax rate (%)',
    fieldReverseCharge: 'Reverse charge (EU B2B)',
    fieldPaymentTerms: 'Payment terms (days)',
    fieldNotes: 'Default invoice notes',
    fieldNotesPlaceholder: 'Optional — appended to the invoice on creation.',

    sectionLineTemplate: 'Default line items',
    sectionLineTemplateHint:
      'Optional — items added here are inserted when the preset prefills a new draft. Quantities and prices are still editable per invoice.',
    addTemplateLine: 'Add template line',

    snapshotImmutabilityNote:
      'Editing a preset does not change invoices that already exist. Invoices keep an immutable copy of the billing details captured when they were created.',
  },
  // ── Dashboard ──────────────────────────────────────────────────────────────
  dashboard: {
    summaryOpenRequests: 'Open Requests',
    summaryUnread: 'Unread Messages',
    summaryToday: 'Today',
    summaryLoading: 'Loading dashboard...',
    lastActionPrefix: 'Last action:',
    lastActionBy: 'by',
    lastActionNone: 'No recent activity.',
    swipesUsed: '{used} / {total} swipes used today',
    swipeLimitReached: 'Daily limit reached. Upgrade to continue.',
    swipeLimitLoading: 'Checking swipe limit...',
    profileCompletion: 'Profile {percent}% complete',
    profileCompleteAll: 'Profile complete',
    searchPlaceholder: 'Search models, castings, chats...',
    searchResultsModels: 'Models',
    searchResultsOptions: 'Option Requests',
    searchResultsChats: 'Chats',
    searchNoResults: 'No results found.',
    searchMinLength: 'Type at least 2 characters to search.',
    conflictWarning: 'Conflict detected: an existing event overlaps this time slot.',
    conflictWarningTitle: 'Schedule Conflict',
    activeOptionsTitle: 'My Active Options',
    activeOptionsEmpty: 'No active option requests.',
    activeOptionsGrouped: 'Grouped by status',
    inboxTitle: 'Inbox',
    profileTab: 'Profile',
    inboxEmpty: 'No messages or requests.',
    inboxActionRequired: 'Action Required',
    inboxUnread: 'Unread',
    orgMetricsTitle: 'Performance',
    orgMetricsTotalOptions: 'Total Options',
    orgMetricsConfirmed: 'Confirmed',
    orgMetricsConversion: 'Conversion Rate',
    orgMetricsLoading: 'Loading metrics...',
    orgMetricsError: 'Could not load metrics.',
    filterExplanation: 'Filtered by:',
    filterSeenHidden: 'Already seen models hidden',
    filterNearMe: 'Near me',
    filterSportsWinter: 'Winter sports',
    filterSportsSummer: 'Summer sports',
    filterHair: (h: string) => `Hair ${h}`,
    filterEthnicities: (n: number) => `Ethnicities (${n})`,
    filterMeasurements: (label: string, range: string) => `${label} ${range} cm`,
    /** Near me is on but we have no coordinates and no city for fallback — list is not distance-sorted. */
    nearbyNeedsLocation:
      'Near me is on, but location is unavailable. Allow location access or set your city in filters to sort by distance.',
    nearbyLoadFailed: 'Could not load nearby models. Check your connection and try again.',
    nearbyOverridesCountry: 'Near me searches globally by radius — country filter is not applied.',
    discoveryLoadMoreFailed:
      'Could not load more results. Scroll up and try again, or adjust filters.',
    optionChecklistDate: 'Date is required',
    optionChecklistRole: 'Role is required',
    quickReplyLabel: 'Quick reply',
    threadContextOption: 'Option',
    threadContextCasting: 'Casting',
    threadContextBooking: 'Booking',
    /** Once an option/casting becomes a confirmed job (final_status = 'job_confirmed'). */
    threadContextJob: 'Job',
    orgFilterAllClients: 'All clients',
    orgFilterMyClients: 'My clients',
    orgFilterUnassigned: 'Unassigned',
    orgFilterNoClients: 'No clients yet',
    /** Option request row when model_name is null (search / lists). */
    optionRequestUnnamedModel: 'Unnamed model',
    /** Workflow badge when toDisplayStatus === Draft */
    optionRequestWorkflowDraft: 'Draft',
    /** Option / casting request thread — negotiation lifecycle (Messages list pills). */
    optionRequestStatusInNegotiation: 'In negotiation',
    /** After client_price_status accepted + commercial anchor; before option_confirmed / job. */
    optionRequestStatusPriceAgreed: 'Price agreed',
    optionRequestStatusConfirmed: 'Confirmed',
    /** Agency confirmed availability (option_confirmed) but linked model has not confirmed yet — not fully closed. */
    optionRequestStatusAvailabilityConfirmedAwaitingModel:
      'Availability confirmed · awaiting model',
    optionRequestStatusRejected: 'Rejected',
    optionRequestStatusJobConfirmed: 'Job confirmed',
    optionRequestStatusPending: 'Pending',
    optionRequestModelApprovalApproved: 'Model approved',
    optionRequestModelApprovalRejected: 'Model rejected',
    optionRequestModelApprovalPending: 'Pending model approval',
    optionRequestModelApprovalNoApp: 'No model app account',
    optionRequestFinalStatusNoModelAppHint:
      'No model app account - negotiate with the client only. When you confirm the option or casting, it is booked and syncs to client and agency calendars.',
    smartAttentionLabel: 'Action required',
    smartAttentionNoAttention: 'No action required',
    smartAttentionWaitingForClient: 'Waiting for client',
    smartAttentionWaitingForAgency: 'Waiting for agency',
    smartAttentionWaitingForAgencyConfirmation: 'Waiting for agency confirmation',
    smartAttentionWaitingForModel: 'Waiting for model approval',
    smartAttentionCounterPending: 'Counter pending',
    smartAttentionConflictRisk: 'Conflict risk',
    smartAttentionJobConfirmationPending: 'Job confirmation pending',
    smartAttentionPriceAgreedAwaitingConfirmation: 'Price agreed — awaiting confirmation',
    smartAttentionFilterAll: 'All attention',
    smartAttentionFilterActionRequired: 'Action required only',
    /** Shown briefly after negotiation actions that sync to calendar (UI only). */
    negotiationCalendarSyncedHint: 'This option is reflected in your calendar.',
    reminderSet: 'Reminder set',
    reminderNone: 'No reminder',
    weekViewLabel: 'Week',
    monthViewLabel: 'Month',
    colorCastingLabel: 'Casting',
    colorOptionLabel: 'Option',
    colorPersonalLabel: 'Personal',
  },
  pdfExport: {
    buttonLabel: 'Download PDF',
    title: 'Export as PDF',
    selectAll: 'Select all',
    deselectAll: 'Deselect all',
    downloadButton: 'Download',
    cancelButton: 'Cancel',
    generating: 'Generating PDF...',
    success: 'PDF downloaded successfully.',
    errorGeneric: 'PDF generation failed. Please try again.',
    noImagesNote: 'No images available',
    footerText: 'Generated via Index Casting',
    imageCountSuffix: (count: number) => `${count} img`,
  },
  aiAssistant: {
    buttonLabel: 'AI Help',
    title: 'AI Help',
    closeLabel: 'Close AI Help',
    inputPlaceholder: 'Ask about using IndexCasting...',
    send: 'Send',
    sending: 'Sending...',
    disclaimer:
      'I can help explain how IndexCasting works. I do not have access to live account data yet.',
    initialMessage: 'Hi, I can explain IndexCasting workflows and where to find things in the app.',
    unavailable: 'AI Help is temporarily unavailable. Please try again later or contact support.',
    emptyQuestion: 'Enter a question first.',
    liveDataRefusal:
      "I don't have access to your live data yet. I can explain where to find this in IndexCasting.",
    subtitles: {
      agency: 'You are using IndexCasting as an Agency.',
      client: 'You are using IndexCasting as a Client.',
      model: 'Model account guidance',
    },
  },
  agencyShare: {
    // Sender — entry point in AgencyControllerView
    sectionTitle: 'Share Roster with Another Agency',
    sectionSubtitle:
      'Send selected models to another agency on Index Casting. They become a co-agency for the territories they choose. You remain the home agency for each model.',
    sendToAgencyToggle: 'Send to another agency instead of a client',
    recipientEmailLabel: 'Recipient agency email',
    recipientEmailPlaceholder: 'agency@example.com',
    recipientResolvedHint: 'Recipient agency: ',
    recipientUnresolvedHint:
      'No agency account found for this email. The recipient must sign up on Index Casting first.',
    labelPlaceholder: 'Optional label (e.g. "FW26 Berlin scouting")',
    expiresInDaysLabel: 'Expires after (days)',
    sendButton: 'Send roster',
    sendingButton: 'Sending…',
    sendSuccessTitle: 'Share sent',
    sendSuccessBody: 'The recipient agency has been notified by email.',
    sendErrorTitle: 'Could not send share',
    selfShareError: 'You cannot send a roster share to your own agency.',
    invalidModelsError: 'At least one selected model is not in your home agency yet.',
    noModelsError: 'Select at least one model first.',
    invalidEmailError: 'Enter a valid recipient email address.',
    recipientNotFoundError:
      'No agency account exists for this email. Ask the recipient to sign up on Index Casting before resending.',
    emailFailedNotice:
      'Roster share was created but the email could not be delivered. Share the link manually if needed.',
    copyLinkLabel: 'Copy share link',
    linkCopied: 'Link copied to clipboard.',

    // Recipient — inbox + detail
    inboxTitle: 'Roster Shares from Other Agencies',
    inboxEmpty: 'No incoming roster shares yet.',
    inboxLoading: 'Loading roster shares…',
    inboxError: 'Could not load roster shares. Try again later.',
    inboxModelCountSingular: '1 model',
    inboxModelCountPlural: '{count} models',
    inboxFromAgency: 'From: {agency}',
    inboxOpenButton: 'Open',
    inboxExpiresAt: 'Expires {date}',
    inboxNoExpiry: 'No expiry',
    inboxInactive: 'Inactive',

    detailTitle: 'Incoming Roster Share',
    detailSubtitle:
      'Pick the territories you would like to represent for each model. The original agency stays the home of the model profile; you become a co-agency only for the territories you select.',
    detailLoading: 'Loading roster…',
    detailError: 'Could not load roster.',
    detailEmpty: 'This share contains no models.',
    countryPickerLabel: 'Territories you will represent',
    countryPickerPlaceholder: 'Select countries…',
    importButton: 'Import to my roster',
    importingButton: 'Importing…',
    importSuccessTitle: 'Import complete',
    importSuccessBody: '{imported} model territor{ies} added to your roster.',
    importPartialBody: '{imported} added · {skipped} already represented by another agency.',
    importNoneBody:
      'No new territories were added. All selected combinations are already represented by another agency.',
    importErrorTitle: 'Import failed',
    importErrorBody: 'No territories could be imported. Try again later.',
    skippedConflictTitle: 'Already represented',
    skippedConflictRow: '{model} · {country} — already represented by another agency',

    // Per-model card actions in detail view
    modelHasAccount: 'Model has an account',
    modelNoAccount: 'Model has no account yet',
    generateClaimTokenButton: 'Generate claim link',
    claimTokenSuccess: 'Claim link generated. Send it to the model securely.',
    claimTokenError: 'Could not generate claim link.',
    chestLabel: 'Chest (cm)',
    waistLabel: 'Waist (cm)',
    hipsLabel: 'Hips (cm)',
    heightLabel: 'Height (cm)',
    cityLabel: 'City',

    // Routing / open from email
    openingShare: 'Opening roster share…',
    openShareNotAuthorized:
      'This roster share is for a different agency account. Sign in with the correct agency to open it.',
    openShareNotFound: 'This roster share is no longer available.',
    openShareLoginRequired: 'Sign in with your agency account to open this roster share.',
  },
  /**
   * Trust Center — public pages (no auth) that communicate enterprise-grade
   * security, GDPR posture, sub-processors, DPA terms, and incident response.
   * All copy is intentionally static and inline; there are no RPC calls from
   * Trust pages so the content is reviewable in code and stable for legal sign-off.
   */
  trust: {
    lastUpdated: 'Last updated: 2026-04-19',
    backToHome: '← Back to home',
    backToTrust: '← Back to Trust Center',
    contactLabel: 'Contact',
    contactEmail: 'security@indexcasting.com',
    privacyEmail: 'privacy@indexcasting.com',
    /** Live status badge (small box on Trust Center overview, polls /status). */
    liveStatusOk: 'All systems operational',
    liveStatusDegraded: 'Some systems degraded',
    liveStatusOutage: 'Service disruption',
    liveStatusUnknown: 'Status unknown',
    liveStatusViewDetails: 'View live status →',

    // ─── Trust Center Overview (/trust) ─────────────────────────────────────
    centerTitle: 'Trust Center',
    centerSubtitle:
      'Enterprise-grade security, privacy, and reliability for agencies, clients, and models on IndexCasting.',
    centerIntro:
      'IndexCasting is a B2B platform for fashion casting workflows. Multi-tenant isolation, GDPR compliance, and operational transparency are foundational requirements — not optional features. This Trust Center documents how we run the platform and what you can expect from us as a sub-processor of your data.',
    cardSecurityTitle: 'Security & Architecture',
    cardSecurityBody:
      'How the platform is built, how data is isolated, how secrets are managed, and how we authenticate users.',
    cardDpaTitle: 'Data Processing Addendum (DPA)',
    cardDpaBody:
      'GDPR Art. 28 DPA template, processed data categories, retention, and technical and organizational measures.',
    cardSubprocessorsTitle: 'Sub-processors',
    cardSubprocessorsBody:
      'Current list of third-party providers that process customer data on our behalf, with regions and DPA status.',
    cardGdprTitle: 'GDPR & Data Subject Rights',
    cardGdprBody:
      'Export, deletion, and rectification rights, in-app self-service paths, and retention windows by data category.',
    cardIncidentTitle: 'Incident Response',
    cardIncidentBody:
      'Detection pipeline, escalation path, customer communication via the live status page, and post-incident review.',
    cardStatusTitle: 'Live System Status',
    cardStatusBody:
      'Continuous health checks for RLS integrity, data invariants, and platform availability.',

    // ─── Trust Security (/trust/security) ───────────────────────────────────
    securityTitle: 'Security & Architecture',
    securityIntro:
      'IndexCasting is built on a defense-in-depth model. Every layer assumes the layer above it could be compromised and adds an independent check.',
    securityArchTitle: 'Platform architecture',
    securityArchBody:
      'The application runs on Supabase Postgres (managed in the EU region) for primary storage and authentication, with the web frontend deployed on Vercel’s edge. All traffic is TLS 1.2+. Backups, point-in-time recovery, and at-rest encryption are managed by Supabase under their SOC 2 / ISO 27001 program.',
    securityRlsTitle: 'Multi-tenant isolation (Row Level Security)',
    securityRlsBody:
      'Tenant isolation is enforced at the database layer. Every multi-tenant table has Row Level Security policies that scope reads and writes to the caller’s organization or assigned roles. Policies are reviewed against a recursion guardrail (no policy may form a cycle through profiles or models) and supported by a continuous health check.',
    securityAdminTitle: 'Admin access & key principles',
    securityAdminBody:
      'There is exactly one platform admin identity, pinned by both UUID and email at the database function layer. Admin RPCs require an explicit assertion (assert_is_admin), and a partial unique index prevents the creation of additional admin profiles. Admin authentication runs through three independent detection layers so a single failure cannot lock the operator out.',
    securityAuthTitle: 'Authentication',
    securityAuthBody:
      'User authentication uses Supabase Auth (email/password and magic link). Models are linked to their accounts via a one-time, hashed claim token rather than email matching. Invitation flows persist tokens until verified server-side acceptance succeeds — never on optimistic client state.',
    securitySecretsTitle: 'Secret management',
    securitySecretsBody:
      'Service-role keys are restricted to Supabase Edge Functions and are never shipped to the frontend. All operational secrets (Stripe webhook secrets, API keys for sub-processors) are stored exclusively in environment variables on Supabase Edge Functions and Vercel and are rotated on a defined cadence.',
    securityUploadsTitle: 'Uploads & content',
    securityUploadsBody:
      'Uploaded files are validated for MIME type, magic-byte signatures, file extension consistency, and safe paths before reaching storage. Private buckets require signed URLs with short TTLs; storage policies are enforced via SECURITY DEFINER helper functions so a Row Level Security regression on profile or model tables cannot widen storage access.',
    securityVulnTitle: 'Vulnerability disclosure',
    securityVulnBody:
      'Security researchers may report findings to security@indexcasting.com. We commit to acknowledging receipt within two business days and providing a remediation timeline within ten business days. We do not pursue legal action against good-faith researchers.',

    // ─── Trust DPA (/trust/dpa) ─────────────────────────────────────────────
    dpaTitle: 'Data Processing Addendum',
    dpaIntro:
      'This page summarizes the Article 28 GDPR Data Processing Addendum (DPA) that governs IndexCasting’s processing of personal data on behalf of customer organizations. A countersigned PDF version is available on request from privacy@indexcasting.com.',
    dpaPartiesTitle: 'Parties',
    dpaPartiesBody:
      'Controller: the customer organization (Agency or Client). Processor: IndexCasting GmbH (Germany). Sub-processors: see the Sub-processors page in this Trust Center.',
    dpaScopeTitle: 'Subject matter and duration',
    dpaScopeBody:
      'The processor processes personal data strictly to provide the IndexCasting platform under the master subscription terms. Processing duration matches the active subscription plus any required retention windows specified in this DPA.',
    dpaCategoriesTitle: 'Categories of data subjects',
    dpaCategoriesBody:
      'Agency owners and bookers; client owners and employees; models (including, with explicit consent, minors represented by a guardian-approved agency).',
    dpaDataTitle: 'Categories of personal data',
    dpaDataBody:
      'Identification and contact data (name, email, phone), professional measurement data (height, chest/waist/hips, etc.), portfolio and polaroid images, location data (city, country, optional approximate coordinates with explicit consent), workflow metadata (option requests, calendar events, messages), and billing metadata for organizations.',
    dpaPurposesTitle: 'Purposes of processing',
    dpaPurposesBody:
      'Hosting and operating the platform, facilitating casting and booking workflows between agencies and clients, providing model self-service, generating shareable selections and packages on customer instruction, and fulfilling legal obligations.',
    dpaRetentionTitle: 'Retention',
    dpaRetentionBody:
      'Active organization data is retained for the lifetime of the subscription. On organization deletion, personal data is deleted or anonymized within 30 days, with documented exceptions only where law requires longer retention. Audit logs are retained for 12 months. Backups are rotated within 30 days.',
    dpaTomTitle: 'Technical and organizational measures',
    dpaTomBody:
      'Encryption at rest and in transit; multi-tenant isolation via Row Level Security; least-privilege role-based access; SECURITY DEFINER helper functions with explicit auth, membership, and resource-ownership guards; continuous invariant health checks; signed URLs for private storage; comprehensive audit trail; and structured incident response.',
    dpaTransfersTitle: 'International transfers',
    dpaTransfersBody:
      'Primary processing takes place in the EU. Where a sub-processor processes data outside the EEA, transfers are governed by Standard Contractual Clauses and supplementary measures as appropriate.',
    dpaSubprocessorsTitle: 'Sub-processors',
    dpaSubprocessorsBody:
      'A current list is maintained on the Sub-processors page. Customers may subscribe to a notification list to be informed of additions or replacements at least 14 days in advance.',
    dpaRightsTitle: 'Data subject rights',
    dpaRightsBody:
      'The processor assists the controller in fulfilling Articles 12–22 GDPR (information, access, rectification, erasure, portability). Self-service export and deletion are available in the application; manual assistance is provided on request within statutory deadlines.',

    // ─── Sub-processors (/trust/subprocessors) ──────────────────────────────
    subTitle: 'Sub-processors',
    subIntro:
      'IndexCasting engages the following sub-processors to deliver the platform. Each sub-processor is bound by a written contract that imposes data protection obligations equivalent to this DPA.',
    subTableNameHeader: 'Sub-processor',
    subTablePurposeHeader: 'Purpose',
    subTableRegionHeader: 'Region',
    subTableDpaHeader: 'DPA / SCCs',
    subSupabaseName: 'Supabase, Inc.',
    subSupabasePurpose: 'Postgres database, authentication, storage, and edge functions.',
    subSupabaseRegion: 'EU (Frankfurt)',
    subSupabaseDpa: 'DPA + SCCs in place',
    subVercelName: 'Vercel Inc.',
    subVercelPurpose: 'Web frontend hosting and edge content delivery.',
    subVercelRegion: 'Global edge / EU',
    subVercelDpa: 'DPA + SCCs in place',
    subStripeName: 'Stripe Payments Europe, Ltd.',
    subStripePurpose: 'Subscription billing, payment processing, and tax handling.',
    subStripeRegion: 'EU (Ireland)',
    subStripeDpa: 'DPA in place',
    subResendName: 'Resend',
    subResendPurpose: 'Transactional email delivery (invitations, notifications, password resets).',
    subResendRegion: 'EU / US',
    subResendDpa: 'DPA + SCCs in place',
    subOptionalNotice:
      'Customers may also opt in to optional integrations (e.g. Mediaslide, Netwalk) for external roster synchronization. Optional integrations only activate after explicit per-organization configuration and are documented separately.',
    subChangesTitle: 'Sub-processor changes',
    subChangesBody:
      'New or replaced sub-processors are announced at least 14 days before they begin processing customer data, giving customers the opportunity to object before the change takes effect.',

    // ─── GDPR (/trust/gdpr) ─────────────────────────────────────────────────
    gdprTitle: 'GDPR & Data Subject Rights',
    gdprIntro:
      'IndexCasting complies with the General Data Protection Regulation (EU) 2016/679. This page explains how the rights of data subjects are honored on the platform.',
    gdprAccessTitle: 'Right of access (Art. 15)',
    gdprAccessBody:
      'Authenticated users can review their profile data, organization memberships, and uploaded media at any time within the application. A structured personal-data export is available in account settings.',
    gdprRectificationTitle: 'Right to rectification (Art. 16)',
    gdprRectificationBody:
      'Profile fields, model measurements, and uploaded media are editable in-app. Bookers and Owners may correct organization-wide records they administer.',
    gdprErasureTitle: 'Right to erasure (Art. 17)',
    gdprErasureBody:
      'Users may delete their account from settings; Owners may delete the organization. Personal data is removed or anonymized within 30 days, except where law requires retention. Backups roll within 30 days.',
    gdprPortabilityTitle: 'Right to data portability (Art. 20)',
    gdprPortabilityBody:
      'A machine-readable JSON export covering profile data, organization memberships, calendar events, messages, and metadata is available in account settings.',
    gdprObjectTitle: 'Right to object & restrict (Art. 21–22)',
    gdprObjectBody:
      'Users may object to processing or restrict it by contacting privacy@indexcasting.com. Automated decision-making with legal effects is not used by the platform.',
    gdprMinorsTitle: 'Minors',
    gdprMinorsBody:
      'Where a model under 18 is represented, the platform requires explicit consent metadata from the responsible agency, including guardian acknowledgement. Consent metadata is stored alongside the model record and surfaced in audit logs.',
    gdprContactTitle: 'How to exercise your rights',
    gdprContactBody:
      'For requests that cannot be completed in-app, contact privacy@indexcasting.com. We respond within statutory deadlines (typically one month, extendable by two months for complex requests).',

    // ─── Incident Response (/trust/incident-response) ───────────────────────
    incidentTitle: 'Incident Response',
    incidentIntro:
      'IndexCasting operates a structured incident response program designed to detect, contain, communicate, and learn from operational and security incidents.',
    incidentDetectionTitle: '1. Detection',
    incidentDetectionBody:
      'Continuous health checks (RLS recursion smoke tests, invariant validators, cancelled calendar drift, zombie organization detection, admin count guard, etc.) run every five minutes via pg_cron and write to the system_health_checks table. Frontend and edge-function errors stream into system_events. Critical states trigger admin notifications.',
    incidentTriageTitle: '2. Triage',
    incidentTriageBody:
      'On detection, the on-call admin classifies the incident by severity (P1 platform outage, P2 partial degradation, P3 isolated regression). P1 and P2 incidents are reflected on the public live status page within 15 minutes.',
    incidentContainTitle: '3. Containment',
    incidentContainBody:
      'Each incident class has a documented containment runbook. For data-integrity issues, the affected scope is computed using append-only invariant violation logs. For security issues, the principle is to deny first, then investigate.',
    incidentCommsTitle: '4. Customer communication',
    incidentCommsBody:
      'Status updates are posted to the public /status page. Owners of affected organizations receive direct notification by email within 24 hours of confirmation for any incident that affects their data.',
    incidentReviewTitle: '5. Post-incident review',
    incidentReviewBody:
      'Every P1 and P2 incident triggers a written post-incident review covering timeline, root cause, contributing factors, customer impact, remediation steps, and prevention. Reviews are summarized in the customer-facing changelog where appropriate.',
    incidentBreachTitle: 'Personal data breach notification',
    incidentBreachBody:
      'Where Article 33 GDPR applies, controllers are notified without undue delay and in any event within 72 hours of confirmation, with the information required by Article 33(3).',
    incidentReportTitle: 'Reporting an incident',
    incidentReportBody:
      'To report a security incident or vulnerability, contact security@indexcasting.com. Include reproduction steps if applicable. We acknowledge within two business days.',

    // ─── Status Page (/status) ──────────────────────────────────────────────
    statusTitle: 'System Status',
    statusSubtitle:
      'Live operational health for the IndexCasting platform. Refreshes automatically every 60 seconds.',
    statusOverallOk: 'All systems operational',
    statusOverallDegraded: 'Some systems degraded',
    statusOverallOutage: 'Service disruption',
    statusOverallUnknown: 'Status unknown',
    statusLastUpdated: 'Last updated',
    statusCheckHeader: 'Check',
    statusCheckStatus: 'Status',
    statusCheckLastRun: 'Last run',
    statusLoadFailed: 'Status data is temporarily unavailable.',
    statusLoading: 'Loading status…',
    statusEmpty: 'No public health checks are configured yet.',
    statusBackToTrust: '← Back to Trust Center',
    statusContactNote: 'For incident communication or escalation, email security@indexcasting.com.',
  },
} as const;

export type UiCopyKey = typeof uiCopy;
