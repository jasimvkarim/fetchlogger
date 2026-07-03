// Framework-agnostic entry. React wrapper lives at "@jasimvk/fetchlogger/react".
export {
  installFetchLogger,
  uninstallFetchLogger,
  subscribe,
  getLogs,
  clearLogs,
  isInstalled,
  isProductionBlocked,
  // Throttle
  setThrottle,
  getThrottle,
  // Overrides (mock response / rewrite request)
  addOverride,
  updateOverride,
  removeOverride,
  clearOverrides,
  getOverrides,
  subscribeOverrides,
  // Cache clear
  clearBrowserCache,
  type FetchLog,
  type InstallOptions,
  type OverrideRule,
} from "./core";

export {
  installConsoleLogger,
  uninstallConsoleLogger,
  subscribeConsole,
  getConsoleLogs,
  clearConsoleLogs,
  isConsoleInstalled,
  type ConsoleLog,
  type ConsoleLevel,
  type ConsoleOptions,
} from "./console";

export { buildDebugReport, type DebugReportOptions } from "./report";

export { mountFetchLoggerPanel, type MountOptions } from "./panel";
