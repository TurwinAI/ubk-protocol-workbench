import type { Artifact } from './types';

const WEBSITE_SURFACE_HINTS = new Set([
  'website',
  'web',
  'web_app',
  'app',
  'prototype',
  'landing',
  'landing_page',
  'site',
]);

const REPORT_HTML_MARKERS = [
  'execution-report-view-button',
  'execution-website-view-button',
  'execution-report-surface-toggle',
  'execution-panel-shell',
  'new report updates detected',
  'refresh report',
  'decision package',
  'application/vnd.turwin.report+json',
  'report-viewer--calm',
  'data-report-surface=',
];

const normalizeHintValue = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
};

export const hasWebsiteSurfaceHint = (value: unknown): boolean => {
  const normalized = normalizeHintValue(value);
  if (!normalized) return false;
  if (WEBSITE_SURFACE_HINTS.has(normalized)) return true;
  return Array.from(WEBSITE_SURFACE_HINTS).some((token) => normalized.includes(token));
};

export const isExplicitWebsiteArtifactCandidate = (input: {
  artifact?: Artifact;
  itemType?: string;
  itemTitle?: string;
}): boolean => {
  const metadata =
    input.artifact?.metadata && typeof input.artifact.metadata === 'object' && !Array.isArray(input.artifact.metadata)
      ? (input.artifact.metadata as Record<string, unknown>)
      : null;

  const hints = [
    metadata?.['surface'],
    metadata?.['artifactRole'],
    metadata?.['renderTarget'],
    metadata?.['presentationSurface'],
    input.itemType,
    input.itemTitle,
    input.artifact?.title,
  ];

  return hints.some((hint) => hasWebsiteSurfaceHint(hint));
};

export const isReportLikeHtmlContent = (content: string): boolean => {
  const normalized = (content || '').toLowerCase();
  if (!normalized) return false;
  return REPORT_HTML_MARKERS.some((marker) => normalized.includes(marker));
};

export const isProtocolFramedHtml = (value: string): boolean => {
  const normalized = (value || '').toLowerCase();
  if (!normalized) return false;
  return (
    normalized.includes('protocol execution') ||
    normalized.includes('protocol website') ||
    normalized.includes('execution report') ||
    normalized.includes('decision package')
  );
};
