// Framework-agnostic entry. React wrapper lives at "@jasimvk/fetchlogger/react".
export {
  installFetchLogger,
  uninstallFetchLogger,
  subscribe,
  getLogs,
  clearLogs,
  isInstalled,
  type FetchLog,
  type InstallOptions,
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

export { mountFetchLoggerPanel, type MountOptions } from "./panel";
