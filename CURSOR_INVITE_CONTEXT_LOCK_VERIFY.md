# CURSOR_INVITE_CONTEXT_LOCK_VERIFY

Manuelle und automatische Prüfungen:

- [ ] **Invite context does not look like free self-service sign-up:** Öffne `?invite=` mit gültigem Token → Gate zeigt „join … as Booker/Employee“ und Hinweis „not a normal sign-up“; Auth zeigt Einladungs-Subtitle.
- [ ] **Booker/Employee role is clearly predetermined:** Auf Auth im Invite-Flow keine Rollen-Pills; Zeile „Your role is set by this invitation: Booker (Agency) / Employee (Client) …“.
- [ ] **Model claim is clearly distinct:** `?model_invite=` Gate mit „not … Booker or Employee“; Auth-Banner „Claim your model profile“.
- [ ] **Success state only appears after actual finalization:** Nach Login mit persistiertem Token: Banner erscheint erst nach erfolgreichem Accept/Claim (nicht allein nach Sign-up ohne Session). Bei E-Mail-Bestätigung: erst nach Confirm + Sign-in + RPC.
- [ ] **No auth/admin/paywall regression:** Admin-Login, normaler Sign-up ohne Invite, Guest-Flow unverändert verhalten; `npm run typecheck`, `npm run lint`, `npm test -- --passWithNoTests --ci` grün.

Automatisiert (ausgeführt in dieser Session): `typecheck`, `lint`, `jest` — alle grün.
