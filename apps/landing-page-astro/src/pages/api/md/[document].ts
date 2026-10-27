import { markdownRoutes } from '../../../data/markdown-registry';
import { siteIdentity } from '../../../data/site-identity';
export function getStaticPaths() {
  return [{ params: { document: '_catalog' } }, { params: { document: '_identity' } }];
}
export function GET({ params }: { params: { document: string } }) {
  return new Response(
    JSON.stringify(params.document === '_catalog' ? markdownRoutes : siteIdentity),
    {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    }
  );
}
