/**
 * Minimal layout for the chat embed page.
 * No global nav, no body styles -- just a transparent container
 * suitable for rendering inside an iframe on a customer's site.
 */
export const metadata = {
  title: "CLIaaS Chat",
};

export default function EmbedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
