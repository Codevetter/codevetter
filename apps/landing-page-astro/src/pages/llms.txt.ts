import { handleMarkdownDocument } from '../data/markdown-registry';
export function GET() {
  return handleMarkdownDocument(new Request('https://codevetter.com/llms.txt'));
}
