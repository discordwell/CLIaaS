// ---- Types ----

export interface Brand {
  id: string;
  name: string;
  subdomain: string;
  logo: string;
  primaryColor: string;
  portalTitle: string;
  kbEnabled: boolean;
  chatEnabled: boolean;
  createdAt: string;
}

// ---- In-memory store ----

const brands: Brand[] = [];
let defaultsLoaded = false;

function ensureDefaults(): void {
  if (defaultsLoaded) return;
  defaultsLoaded = true;

  brands.push(
    {
      id: 'brand-main',
      name: 'Main Support',
      subdomain: 'main',
      logo: '/logo.svg',
      primaryColor: '#09090b',
      portalTitle: 'Help Center',
      kbEnabled: true,
      chatEnabled: true,
      createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    },
    {
      id: 'brand-enterprise',
      name: 'Enterprise',
      subdomain: 'enterprise',
      logo: '/logo-ent.svg',
      primaryColor: '#1d4ed8',
      portalTitle: 'Enterprise Support Portal',
      kbEnabled: true,
      chatEnabled: false,
      createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
    }
  );
}

// ---- Public API ----

export function listBrands(): Brand[] {
  ensureDefaults();
  return [...brands];
}

export function getBrandBySubdomain(subdomain: string): Brand | undefined {
  ensureDefaults();
  return brands.find((b) => b.subdomain === subdomain);
}

export function createBrand(
  input: Omit<Brand, 'id' | 'createdAt'>
): Brand {
  ensureDefaults();
  const brand: Brand = {
    ...input,
    id: `brand-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  brands.push(brand);
  return brand;
}

export function updateBrand(
  id: string,
  updates: Partial<Omit<Brand, 'id' | 'createdAt'>>
): Brand | null {
  ensureDefaults();
  const idx = brands.findIndex((b) => b.id === id);
  if (idx === -1) return null;
  brands[idx] = { ...brands[idx], ...updates };
  return brands[idx];
}

export function deleteBrand(id: string): boolean {
  ensureDefaults();
  const idx = brands.findIndex((b) => b.id === id);
  if (idx === -1) return false;
  brands.splice(idx, 1);
  return true;
}
