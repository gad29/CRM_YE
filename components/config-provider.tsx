'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { DEFAULT_APP_CONFIG, optionLabel, stageLabelOf, type AppConfig } from '@/lib/domain';

type ConfigContextValue = {
  config: AppConfig;
  /** Re-fetch after the settings page saves. */
  refresh: () => void;
};

const ConfigContext = createContext<ConfigContextValue>({ config: DEFAULT_APP_CONFIG, refresh: () => {} });

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_APP_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const pathname = usePathname();

  const refresh = useCallback(() => {
    fetch('/api/config')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && d.data) {
          setConfig(d.data);
          setLoaded(true);
        }
      })
      .catch(() => null);
  }, []);

  // The login page can't read config (no session yet), so keep trying on each
  // navigation until it loads — otherwise the default name sticks after sign-in.
  useEffect(() => {
    if (!loaded) refresh();
  }, [refresh, loaded, pathname]);

  return <ConfigContext.Provider value={{ config, refresh }}>{children}</ConfigContext.Provider>;
}

export function useConfig() {
  return useContext(ConfigContext).config;
}

export function useConfigRefresh() {
  return useContext(ConfigContext).refresh;
}

/** Convenience label resolvers bound to the current config. */
export function useLabels() {
  const config = useConfig();
  return {
    company: (value?: string) => optionLabel(config.companies, value, ''),
    paymentMethod: (value?: string) => optionLabel(config.paymentMethods, value, value ?? ''),
    office: (value?: string) => optionLabel(config.offices, value, value ?? ''),
    stage: (stage: string) => stageLabelOf(config, stage),
  };
}
