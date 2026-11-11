/**
 * Pure routing decision for the career boot gate.
 * Extracted so the navigation logic can be unit-tested without a React
 * Native rendering environment.
 */
export function careerLandingRoute(hasCareer: boolean): '/dashboard' | '/new-career' {
  return hasCareer ? '/dashboard' : '/new-career';
}
