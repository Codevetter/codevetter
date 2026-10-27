import { siteIdentity } from './site-identity';

const siteSchema = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Person',
      '@id': 'https://sarthakagrawal.dev/#person',
      name: 'Sarthak Agrawal',
      jobTitle: 'AI Infrastructure & Product Engineer',
      url: 'https://sarthakagrawal.dev',
      image: 'https://avatars.githubusercontent.com/u/43884471?v=4',
      sameAs: [
        'https://sarthakagrawal.dev',
        'https://www.linkedin.com/in/sarthakagrawal927',
        'https://github.com/sarthakagrawal927',
        'https://x.com/sarthakcodes',
        'https://huggingface.co/sarthakagrawal927',
      ],
      knowsAbout: [
        'AI infrastructure',
        'Local-first software',
        'Post-training language models',
        'Coding agent verification',
        'Cloudflare Workers',
        'TypeScript',
        'Rust',
      ],
      affiliation: {
        '@type': 'Organization',
        '@id': 'https://sassmaker.com/#app',
        name: 'SaaS Maker',
        url: 'https://sassmaker.com',
      },
    },
    {
      '@type': 'Organization',
      '@id': 'https://codevetter.com/#org',
      name: siteIdentity.name,
      alternateName: ['Code Vetter', 'codevetter.com'],
      url: siteIdentity.url,
      logo: 'https://codevetter.com/favicon.svg',
      description: siteIdentity.summary,
      founder: { '@id': 'https://sarthakagrawal.dev/#person' },
      sameAs: [
        'https://github.com/Codevetter',
        'https://github.com/Codevetter/codevetter',
        'https://github.com/Codevetter/starboard',
      ],
      contactPoint: [
        {
          '@type': 'ContactPoint',
          contactType: 'customer support',
          email: siteIdentity.contact,
          url: `${siteIdentity.url}/contact`,
          availableLanguage: ['en'],
        },
      ],
      address: { '@type': 'PostalAddress', addressCountry: 'IN' },
    },
    {
      '@type': 'WebSite',
      '@id': `${siteIdentity.url}/#app`,
      name: siteIdentity.name,
      alternateName: ['Code Vetter', 'codevetter.com'],
      url: siteIdentity.url,
      description: siteIdentity.summary,
      publisher: { '@id': `${siteIdentity.url}/#org` },
      sameAs: ['https://github.com/Codevetter', 'https://github.com/Codevetter/codevetter'],
    },
  ],
};

export function serializeSiteSchema(): string {
  return JSON.stringify(siteSchema).replaceAll('<', '\\u003c');
}
