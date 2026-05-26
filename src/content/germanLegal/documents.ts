import { markdown as impressumMarkdown } from './markdown/impressum';
import { markdown as tomsMarkdown } from './markdown/toms';
import { markdown as loeschkonzeptMarkdown } from './markdown/loeschkonzept';
import { markdown as verarbeitungsverzeichnisMarkdown } from './markdown/verarbeitungsverzeichnis';
import { markdown as subprocessorsMarkdown } from './markdown/subprocessors';

export type GermanLegalDocumentId =
  | 'impressum'
  | 'toms'
  | 'loeschkonzept'
  | 'verarbeitungsverzeichnis'
  | 'subprocessors';

export type GermanLegalDocumentSpec = {
  id: GermanLegalDocumentId;
  title: string;
  description: string;
  path: `/legal/${GermanLegalDocumentId}`;
  markdown: string;
  stand?: string;
  backTo?: string;
  backLabel?: string;
};

function extractTitle(markdown: string): string {
  const first = markdown.split('\n').find((line) => line.startsWith('# '));
  return first ? first.slice(2).trim() : 'Rechtliches Dokument';
}

function extractStand(markdown: string): string | undefined {
  const match = markdown.match(/^Stand:\s*(.+)$/m);
  return match ? `Stand: ${match[1].trim()}` : undefined;
}

const RAW: Array<Omit<GermanLegalDocumentSpec, 'title' | 'stand'> & { title?: string }> = [
  {
    id: 'impressum',
    description: 'Anbieterkennzeichnung gemäß § 5 DDG',
    path: '/legal/impressum',
    markdown: impressumMarkdown,
    backTo: '/',
    backLabel: 'Zurück',
  },
  {
    id: 'toms',
    description: 'Technische und organisatorische Maßnahmen gemäß Art. 32 DSGVO',
    path: '/legal/toms',
    markdown: tomsMarkdown,
    backLabel: 'Zurück zu Rechtliches',
  },
  {
    id: 'loeschkonzept',
    description: 'Speicherbegrenzung, Löschung und Aufbewahrung',
    path: '/legal/loeschkonzept',
    markdown: loeschkonzeptMarkdown,
    backLabel: 'Zurück zu Rechtliches',
  },
  {
    id: 'verarbeitungsverzeichnis',
    description: 'Verzeichnis von Verarbeitungstätigkeiten gemäß Art. 30 DSGVO',
    path: '/legal/verarbeitungsverzeichnis',
    markdown: verarbeitungsverzeichnisMarkdown,
    backLabel: 'Zurück zu Rechtliches',
  },
  {
    id: 'subprocessors',
    description: 'Unterauftragsverarbeiterliste',
    path: '/legal/subprocessors',
    markdown: subprocessorsMarkdown,
    backLabel: 'Zurück zu Rechtliches',
  },
];

export const GERMAN_LEGAL_DOCUMENTS: Record<GermanLegalDocumentId, GermanLegalDocumentSpec> =
  Object.fromEntries(
    RAW.map((doc) => {
      const title = doc.title ?? extractTitle(doc.markdown);
      const stand = extractStand(doc.markdown);
      return [
        doc.id,
        {
          ...doc,
          title,
          stand,
        } satisfies GermanLegalDocumentSpec,
      ];
    }),
  ) as Record<GermanLegalDocumentId, GermanLegalDocumentSpec>;

export const GERMAN_LEGAL_DOC_LIST: GermanLegalDocumentSpec[] = RAW.map(
  (doc) => GERMAN_LEGAL_DOCUMENTS[doc.id],
);

export function getGermanLegalDocument(id: GermanLegalDocumentId): GermanLegalDocumentSpec {
  return GERMAN_LEGAL_DOCUMENTS[id];
}

export type GermanLegalDocumentRoute =
  | 'legal-impressum'
  | 'legal-toms'
  | 'legal-loeschkonzept'
  | 'legal-verarbeitungsverzeichnis'
  | 'legal-subprocessors';

export function germanLegalDocumentForRoute(
  route: GermanLegalDocumentRoute,
): GermanLegalDocumentSpec {
  switch (route) {
    case 'legal-impressum':
      return getGermanLegalDocument('impressum');
    case 'legal-toms':
      return getGermanLegalDocument('toms');
    case 'legal-loeschkonzept':
      return getGermanLegalDocument('loeschkonzept');
    case 'legal-verarbeitungsverzeichnis':
      return getGermanLegalDocument('verarbeitungsverzeichnis');
    case 'legal-subprocessors':
      return getGermanLegalDocument('subprocessors');
    default: {
      const _exhaustive: never = route;
      return _exhaustive;
    }
  }
}
