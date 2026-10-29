'use client';

// Who is signed in. Loaded once per page load from /api/auth/me.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

export type Me = {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'admin' | 'worker';
  isAdmin: boolean;
  mustChangePassword: boolean;
};

const SessionContext = createContext<{ me: Me | null; reload: () => void }>({ me: null, reload: () => undefined });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const reload = useCallback(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => d.ok && setMe({ id: d.id, name: d.name, email: d.email, role: d.role, isAdmin: d.isAdmin, mustChangePassword: d.mustChangePassword }))
      .catch(() => null);
  }, []);
  useEffect(() => reload(), [reload]);
  return <SessionContext.Provider value={{ me, reload }}>{children}</SessionContext.Provider>;
}

export function useSession() {
  return useContext(SessionContext);
}
