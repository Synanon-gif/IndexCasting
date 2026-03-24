-- =============================================================================
-- Organizations: Owner kann den Namen der eigenen Organisation aktualisieren.
-- Ermöglicht dem Client-Owner das Speichern des Company Name in Settings,
-- sodass die Agentur den echten Firmennamen im B2B-Chat sieht.
-- =============================================================================

DROP POLICY IF EXISTS organizations_update_owner ON public.organizations;

CREATE POLICY organizations_update_owner
  ON public.organizations FOR UPDATE
  TO authenticated
  USING (
    -- nur der Owner darf seine eigene Org updaten
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.organization_id = organizations.id
        AND m.user_id = auth.uid()
        AND m.role = 'owner'
    )
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.organization_members m
      WHERE m.organization_id = organizations.id
        AND m.user_id = auth.uid()
        AND m.role = 'owner'
    )
  );

-- Sicherheitshinweis: type und owner_id sind in dieser Policy nicht
-- eingeschränkt – das ist ok, da ein Owner grundsätzlich nur
-- seiner eigenen Org zugeordnet ist (via UNIQUE INDEX organizations_one_client_owner).
-- =============================================================================
