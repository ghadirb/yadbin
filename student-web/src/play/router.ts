/** /play/{token} → token (case preserved; tokens are uppercase base-32 without ambiguous chars). */
export function tokenFromPath(pathname: string): string | null {
  const m = /^\/play\/([A-Za-z0-9]{8,64})\/?$/.exec(pathname);
  return m ? m[1].toUpperCase() : null;
}
