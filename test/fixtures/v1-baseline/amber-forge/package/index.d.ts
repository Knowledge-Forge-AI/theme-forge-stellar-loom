export interface StarlightPluginHooks {
  "config:setup": (context: {
    config: Record<string, unknown>;
    updateConfig: (newConfig: Record<string, unknown>) => void;
    logger?: {
      info: (message: string) => void;
      warn: (message: string) => void;
      error: (message: string) => void;
    };
  }) => void | Promise<void>;
}

export interface StarlightThemePlugin {
  name: string;
  hooks: StarlightPluginHooks;
}

export default function themePlugin(options?: Record<string, unknown>): StarlightThemePlugin;
