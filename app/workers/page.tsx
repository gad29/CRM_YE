import { redirect } from 'next/navigation';

// Moved in the 2026 overhaul; old bookmarks still land in the right place.
export default function WorkersMoved() {
  redirect('/admin/users');
}
