// Who may manage whom. Checked in every /api/users handler.
import type { SessionPayload } from '@/lib/admin-session';
import type { UserRecord, UserRole } from '@/lib/users';

/** May `actor` edit, reset or sign out `target`? */
export function canManage(actor: SessionPayload, target: Pick<UserRecord, 'id' | 'role'>) {
  if (actor.role === 'owner') return true; // the owner's own limits live in updateUser()
  if (actor.role === 'admin') return target.role === 'worker';
  return false;
}

/** May `actor` give someone this role? Only the owner creates or promotes admins. */
export function canAssignRole(actor: SessionPayload, role: UserRole) {
  if (role === 'owner') return false;
  if (role === 'admin') return actor.role === 'owner';
  return actor.role === 'owner' || actor.role === 'admin';
}
