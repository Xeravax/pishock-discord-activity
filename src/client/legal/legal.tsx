import type { ReactNode } from 'react';
import { openExternal } from '../discord';

/** Operator / data controller details shared by the Terms and the Privacy Policy. */
export const LEGAL = {
  operator: 'Xeravax',
  email: 'gdpr@stefanocoding.me',
  subject: 'Pishock Controller: Data Privacy Request',
  community: 'https://discord.gg/M6XjdQmb3E',
  /** Bump when either document changes. */
  effective: '18 November 2026',
} as const;

export const LEGAL_MAILTO = `mailto:${LEGAL.email}?subject=${encodeURIComponent(LEGAL.subject)}`;

/** Links inside the Discord iframe must go through the SDK; plain browsers open normally. */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        e.preventDefault();
        void openExternal(href);
      }}
    >
      {children}
    </a>
  );
}

export function ContactBlock() {
  return (
    <div className="legal-contact">
      <div>
        <span className="legal-contact__label">Operator</span>
        <span>{LEGAL.operator}</span>
      </div>
      <div>
        <span className="legal-contact__label">Email</span>
        <ExternalLink href={LEGAL_MAILTO}>{LEGAL.email}</ExternalLink>
      </div>
      <div>
        <span className="legal-contact__label">Subject line</span>
        <span>&ldquo;{LEGAL.subject}&rdquo;</span>
      </div>
      <div>
        <span className="legal-contact__label">Community</span>
        <ExternalLink href={LEGAL.community}>discord.gg/M6XjdQmb3E</ExternalLink>
      </div>
    </div>
  );
}
