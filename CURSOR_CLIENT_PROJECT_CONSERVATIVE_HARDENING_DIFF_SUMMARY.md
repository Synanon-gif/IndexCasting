# Client Project Conservative Hardening — Diff Summary

| Bereich | Änderung |
|---------|----------|
| Hydration | `fetchHydratedClientProjectsForOrg` → `getModelsByIdsForClientFromSupabase(allIds)` statt N× `getModelByIdForClientFromSupabase` |
| modelsSupabase | Neu: `getModelsByIdsForClientFromSupabase`, Chunk 80, ein `assertPlatformAccess` pro Aufruf |
| RPC | `add_model_to_project(uuid, uuid, uuid)` mit `p_organization_id DEFAULT NULL`; DROP der 2-Arg-Variante |
| projectsSupabase | `addModelToProject` optional 3. Arg `organizationId`; RPC-Args nur mit Org wenn trim-nonempty |
| ClientWebApp | `addModelToProjectOnSupabase(..., clientOrgId)` wenn `clientOrgId` gesetzt |
| Rules | `auto-review.mdc`: Pflichtzeile zu `p_organization_id` bei bekannter Org |

Keine Änderungen an: AuthContext, Paywall-Kern, Package/Shared-Guards, Delete-UI-Logik (bereits korrekt).
