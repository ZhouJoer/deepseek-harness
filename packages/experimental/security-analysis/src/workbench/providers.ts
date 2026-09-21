/** Environment and analysis providers used by the security service. @module */
import type { ArtifactStore } from './artifacts.ts'
import type { AnalysisOperation, Asset } from './model.ts'

/** Operator-configured tool location. */
export interface ToolInstallation {
  /** Provider-facing tool identity within one environment. */
  id: string
  /** Host executable or executable path inside the selected container. */
  command: string
  /** Fixed arguments for reporting the installed version, without a shell. */
  versionArgs: string[]
  /** Operator-recorded origin of the installation. */
  source: string
}
/** An explicit local execution world; container images never silently change. */
export interface SecurityEnvironment {
  /** Stable identity used in project scope and execution leases. */
  id: string
  /** Local process, owned Docker container or selected Android device. */
  kind: 'local' | 'docker' | 'android'
  /** Operator-facing environment name. */
  label: string
  /** Absolute Host directory available as the analysis workspace. */
  cwd: string
  /** Explicit adb/Frida device identity for Android operations. */
  deviceId?: string
  /** Exact local Docker image reference; missing images are not downloaded. */
  image?: string
  /** Installed tool declarations, independent of current runtime readiness. */
  tools: ToolInstallation[]
  /** Runtime-only immutable image identity measured by the environment manager. */
  resolvedImageId?: string
  /** Runtime-only container identity owned by the environment manager. */
  containerId?: string
  /** Runtime-only Host directory mounted for immutable inputs and analysis output. */
  exchangeRoot?: string
}
/** Environment readiness is distinct from tool installation. */
export interface EnvironmentStatus {
  id: string
  ready: boolean
  diagnostics: string[]
  tools: { id: string; available: boolean; version: string; source: string }[]
}
/** Complete bounded provider result before evidence ingestion. */
export interface AnalysisResult {
  bytes: Uint8Array
  mediaType: string
  summary: string
  incomplete: boolean
  toolVersion: string
}
/** One admitted operation's resources and cancellation lifetime. */
export interface AnalysisContext {
  environment: SecurityEnvironment
  asset: Asset
  artifacts: ArtifactStore
  signal: AbortSignal
  durationMs: number
  maxOutputBytes: number
}
/** Replaceable analysis implementation; resolve cannot execute external actions. */
export interface AnalysisProvider {
  id: string
  operations: readonly string[]
  /** Model-visible parameter and prerequisite guidance; omitted providers require separate documentation. */
  inputGuide?: string
  /**
   * Validate and resolve provider-specific inputs before approval.
   * @param request - caller proposal.
   * @param context - fixed asset, environment and limits.
   * @returns exact operation whose complete content will be approved.
   */
  resolve(request: AnalysisOperation, context: AnalysisContext): AnalysisOperation
  /**
   * Save provider-owned script dependencies before the plan is shown for approval.
   * @param request - proposed immutable artifacts.
   * @param context - admitted preparation resources; no target execution is allowed.
   * @returns artifacts and dependency versions that the operator will approve.
   */
  prepare?(request: AnalysisOperation, context: AnalysisContext): Promise<AnalysisOperation>
  /**
   * Execute one admitted request and await resource cleanup.
   * @param request - resolved request.
   * @param context - owning execution resources.
   * @returns raw provider observations and completeness metadata.
   */
  run(request: AnalysisOperation, context: AnalysisContext): Promise<AnalysisResult>
}
/** Replaceable environment execution and health implementation. */
export interface EnvironmentProvider {
  kind: SecurityEnvironment['kind']
  /**
   * Inspect configured capabilities without provisioning missing tools.
   * @param environment - explicit environment.
   * @param signal - cancellation lifetime.
   * @returns availability and failure reasons.
   */
  inspect(environment: SecurityEnvironment, signal: AbortSignal): Promise<EnvironmentStatus>
}
/** Reversible registrations reject ambiguous provider ownership. */
export class ProviderRegistry<T extends { id: string }> {
  private readonly values = new Map<string, T>()
  /**
   * Register a provider for this activation.
   * @param provider - unique named implementation.
   * @returns disposer removing exactly this contribution.
   */
  register(provider: T): () => void {
    if (this.values.has(provider.id)) throw new Error('Duplicate security provider: ' + provider.id)
    this.values.set(provider.id, provider)
    return () => {
      if (this.values.get(provider.id) === provider) this.values.delete(provider.id)
    }
  }
  /**
   * Require a configured provider.
   * @param id - exact provider name.
   * @returns the registered provider; missing capabilities fail explicitly.
   */
  get(id: string): T {
    const value = this.values.get(id)
    if (value === undefined) throw new Error('Unavailable security provider: ' + id)
    return value
  }
  /** Discover registered implementations.
   * @returns registered provider identities. */
  list(): string[] {
    return [...this.values.keys()]
  }
}

/** Operator-facing environment lifecycle implemented outside the domain owner. */
export interface EnvironmentManager {
  /** @param environment - configured world. @param signal - cancellation. @returns health details. */
  inspect(environment: SecurityEnvironment, signal: AbortSignal): Promise<EnvironmentStatus>
  /** @param environment - configured world. @param signal - cancellation. @returns owned runtime identity. */
  start(environment: SecurityEnvironment, signal: AbortSignal): Promise<string>
  /** @param environment - configured world. @param signal - cancellation. @returns completion after release. */
  stop(environment: SecurityEnvironment, signal: AbortSignal): Promise<void>
}
