/** Security service registration shared by Host consumers. @module */
import type SecurityWorkbench from './workbench/index.ts'
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Project authority, evidence and operator validation controls. */
    securityWorkbench: SecurityWorkbench
  }
}
