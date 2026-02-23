/**
 * Access review report generation for SOC 2 compliance.
 * Generates periodic access review reports with role breakdowns,
 * privileged access listings, and actionable recommendations.
 */

// ---- Types ----

export interface AccessReviewReport {
  generatedAt: string;
  totalUsers: number;
  byRole: Record<string, number>;
  privilegedAccess: Array<{
    userId: string;
    name: string;
    role: string;
    lastActive: string;
  }>;
  recommendations: string[];
}

// ---- Public API ----

export function generateAccessReview(): AccessReviewReport {
  const now = new Date();

  // Demo user data simulating a real workspace
  const demoUsers = [
    { userId: 'user-1', name: 'Alice Chen', role: 'admin', lastActive: new Date(now.getTime() - 2 * 3600000).toISOString() },
    { userId: 'user-2', name: 'Bob Martinez', role: 'admin', lastActive: new Date(now.getTime() - 48 * 3600000).toISOString() },
    { userId: 'user-3', name: 'Charlie Park', role: 'agent', lastActive: new Date(now.getTime() - 1 * 3600000).toISOString() },
    { userId: 'user-4', name: 'Dana Kim', role: 'agent', lastActive: new Date(now.getTime() - 72 * 3600000).toISOString() },
    { userId: 'user-5', name: 'Eve Foster', role: 'agent', lastActive: new Date(now.getTime() - 168 * 3600000).toISOString() },
    { userId: 'user-6', name: 'Frank Lopez', role: 'viewer', lastActive: new Date(now.getTime() - 336 * 3600000).toISOString() },
    { userId: 'user-7', name: 'Grace Nguyen', role: 'agent', lastActive: new Date(now.getTime() - 24 * 3600000).toISOString() },
    { userId: 'user-8', name: 'Hiro Tanaka', role: 'viewer', lastActive: new Date(now.getTime() - 720 * 3600000).toISOString() },
    { userId: 'user-9', name: 'Irene Smith', role: 'admin', lastActive: new Date(now.getTime() - 2160 * 3600000).toISOString() },
    { userId: 'user-10', name: 'Jake Brown', role: 'agent', lastActive: new Date(now.getTime() - 4 * 3600000).toISOString() },
  ];

  // Role breakdown
  const byRole: Record<string, number> = {};
  for (const u of demoUsers) {
    byRole[u.role] = (byRole[u.role] || 0) + 1;
  }

  // Privileged access = admin or users with elevated roles
  const privilegedAccess = demoUsers
    .filter((u) => u.role === 'admin')
    .map((u) => ({
      userId: u.userId,
      name: u.name,
      role: u.role,
      lastActive: u.lastActive,
    }));

  // Generate recommendations based on data analysis
  const recommendations: string[] = [];

  // Check for inactive admins (>30 days)
  const thirtyDaysAgo = now.getTime() - 30 * 24 * 3600000;
  const inactiveAdmins = demoUsers.filter(
    (u) => u.role === 'admin' && new Date(u.lastActive).getTime() < thirtyDaysAgo,
  );
  if (inactiveAdmins.length > 0) {
    recommendations.push(
      `Review admin access for ${inactiveAdmins.length} inactive admin(s): ${inactiveAdmins.map((u) => u.name).join(', ')}`,
    );
  }

  recommendations.push(
    'Enable MFA for all admin accounts to meet SOC 2 CC6.1 requirements',
    'Implement quarterly access reviews for privileged roles',
    'Set up automated deprovisioning for accounts inactive >90 days',
    'Review API key permissions and rotate keys older than 90 days',
    'Ensure separation of duties between admin and agent roles',
  );

  // Check for inactive viewers
  const inactiveViewers = demoUsers.filter(
    (u) => u.role === 'viewer' && new Date(u.lastActive).getTime() < thirtyDaysAgo,
  );
  if (inactiveViewers.length > 0) {
    recommendations.push(
      `Consider removing ${inactiveViewers.length} inactive viewer account(s) to reduce attack surface`,
    );
  }

  return {
    generatedAt: now.toISOString(),
    totalUsers: demoUsers.length,
    byRole,
    privilegedAccess,
    recommendations,
  };
}
