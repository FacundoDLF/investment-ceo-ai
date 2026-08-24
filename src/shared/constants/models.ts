import { ANSI_COLORS } from '@/shared/constants/colors';

export type ModelRole = 'CEO' | 'STRATEGIST' | 'ANALYST' | 'EXECUTOR' | 'ROUTER';

export interface AIModel {
  // Clave única compuesta: "provider::modelId"
  uid: string;
  id: string;
  provider: 'groq' | 'openrouter';
  tier: 'free' | 'paid';
  capabilities: {
    reasoning: boolean;
    toolCalling: boolean;
  };
  roles: ModelRole[];
  status: 'active' | 'deprecated';
  health: {
    consecutiveErrors: number;
    rateLimitedUntil: number;
    lastError?: string;
  };
}

function makeModel(
  provider: 'groq' | 'openrouter',
  id: string,
  tier: 'free' | 'paid',
  roles: ModelRole[],
  capabilities: { reasoning: boolean; toolCalling: boolean }
): AIModel {
  return {
    uid: `${provider}::${id}`,
    id,
    provider,
    tier,
    capabilities,
    roles,
    status: 'active',
    health: { consecutiveErrors: 0, rateLimitedUntil: 0 }
  };
}

export const MODEL_REGISTRY: AIModel[] = [
  // CEO / Strategist — Llama 3 70B especializado en Tool Use (groq, free)
  makeModel('groq', 'llama3-groq-70b-8192-tool-use-preview', 'free', ['CEO', 'STRATEGIST'], { reasoning: true, toolCalling: true }),
  makeModel('openrouter', 'qwen/qwen-2.5-72b-instruct', 'paid', ['CEO', 'STRATEGIST'], { reasoning: true, toolCalling: true }),

  // Analyst — qwen3.6-27b (groq, free), deepseek v4 (openrouter, paid)
  makeModel('groq', 'qwen/qwen3.6-27b', 'free', ['ANALYST'], { reasoning: true, toolCalling: true }),
  makeModel('openrouter', 'deepseek/deepseek-v4-flash-0731', 'paid', ['ANALYST'], { reasoning: true, toolCalling: true }),

  // Executor / HFT — gpt-oss-20b (groq, free, rápido), gpt-oss-20b fallback (openrouter)
  makeModel('groq', 'openai/gpt-oss-20b', 'free', ['EXECUTOR', 'ROUTER'], { reasoning: false, toolCalling: true }),
  makeModel('openrouter', 'openai/gpt-oss-20b', 'paid', ['EXECUTOR', 'ROUTER'], { reasoning: false, toolCalling: true }),
];

export class ModelRouter {
  /** Modelo activo por rol (UID). Usado para detectar cambios y notificar. */
  private static _activeUidPerRole = new Map<ModelRole, string>();

  private static readonly ROLE_LABEL: Record<ModelRole, string> = {
    CEO: 'CEO Trader   ',
    STRATEGIST: 'Estratega    ',
    ANALYST: 'Analista     ',
    EXECUTOR: 'Ejecutor HFT ',
    ROUTER: 'Router       ',
  };

  /** Imprime la tabla de modelos activos al inicio del daemon. */
  static printRegistryTable(): void {
    const R = ANSI_COLORS.RESET;
    const B = ANSI_COLORS.BOLD;
    const C = ANSI_COLORS.CYAN;
    const G = ANSI_COLORS.GREEN;
    const Y = ANSI_COLORS.YELLOW;
    const GR = ANSI_COLORS.GRAY;

    const line = `${GR}${'─'.repeat(72)}${R}`;
    console.log(`\n${line}`);
    console.log(`${B}${C}  🤖 MODELOS DE IA ACTIVOS${R}`);
    console.log(line);
    console.log(`${B}  ${'Rol'.padEnd(15)} ${'Proveedor'.padEnd(12)} ${'Tier'.padEnd(6)} Modelo${R}`);
    console.log(line);

    const DISPLAY_ROLES: ModelRole[] = ['CEO', 'ANALYST', 'EXECUTOR'];
    for (const role of DISPLAY_ROLES) {
      const available = this.getAvailableForRole(role);
      const primary = available[0];
      const fallback = available[1];

      if (primary) {
        const tierColor = primary.tier === 'free' ? G : Y;
        const provColor = primary.provider === 'groq' ? C : Y;
        console.log(
          `  ${B}${this.ROLE_LABEL[role]}${R}` +
          ` ${provColor}${primary.provider.padEnd(12)}${R}` +
          ` ${tierColor}${primary.tier.padEnd(6)}${R}` +
          ` ${primary.id}`
        );
        if (fallback) {
          const fTierColor = fallback.tier === 'free' ? G : Y;
          const fProvColor = fallback.provider === 'groq' ? C : Y;
          console.log(
            `  ${''.padEnd(15)}` +
            ` ${GR}↳ fallback:${R}` +
            ` ${fProvColor}${fallback.provider.padEnd(12)}${R}` +
            ` ${fTierColor}${fallback.tier.padEnd(6)}${R}` +
            ` ${GR}${fallback.id}${R}`
          );
        }
      } else {
        console.log(`  ${this.ROLE_LABEL[role]} ${ANSI_COLORS.RED}⚠️  SIN MODELOS DISPONIBLES${R}`);
      }
    }

    console.log(`${line}\n`);
  }

  /** Devuelve los AIModel disponibles para un rol, ordenados por prioridad (free primero). */
  static getAvailableForRole(role?: ModelRole): AIModel[] {
    const now = Date.now();
    return MODEL_REGISTRY
      .filter(m => m.status === 'active')
      .filter(m => role ? m.roles.includes(role) : true)
      .filter(m => m.health.rateLimitedUntil <= now)
      .filter(m => m.health.consecutiveErrors < 3)
      .sort((a, b) => {
        if (a.tier === 'free' && b.tier === 'paid') return -1;
        if (a.tier === 'paid' && b.tier === 'free') return 1;
        return 0;
      });
  }

  /** Registra el modelo que se está usando para un rol. Si cambia, loguea el cambio. */
  static trackActiveModel(role: ModelRole, model: AIModel): void {
    const prev = this._activeUidPerRole.get(role);
    if (prev !== model.uid) {
      this._activeUidPerRole.set(role, model.uid);
      if (prev) {
        // Solo notificar si hubo un cambio real (no en la primera asignación)
        const provColor = model.provider === 'groq' ? ANSI_COLORS.CYAN : ANSI_COLORS.YELLOW;
        const tierLabel = model.tier === 'free' ? `${ANSI_COLORS.GREEN}free${ANSI_COLORS.RESET}` : `${ANSI_COLORS.YELLOW}paid${ANSI_COLORS.RESET}`;
        console.log(
          `${ANSI_COLORS.YELLOW}[Changed Model]${ANSI_COLORS.RESET} ${ANSI_COLORS.BOLD}${this.ROLE_LABEL[role].trim()}${ANSI_COLORS.RESET}` +
          ` → ${provColor}${model.provider}${ANSI_COLORS.RESET}` +
          ` / ${tierLabel}` +
          ` / ${ANSI_COLORS.WHITE}${model.id}${ANSI_COLORS.RESET}`
        );
      } else {
        this._activeUidPerRole.set(role, model.uid);
      }
    }
  }

  static getByUid(uid: string): AIModel | undefined {
    return MODEL_REGISTRY.find(m => m.uid === uid);
  }

  static markAsFailed(uid: string, reason?: string) {
    const model = this.getByUid(uid);
    if (model) {
      model.health.consecutiveErrors += 1;
      model.health.lastError = reason;
      if (model.health.consecutiveErrors >= 3) {
        model.status = 'deprecated';
      }
    }
  }

  static markAsRateLimited(uid: string, waitTimeMs: number) {
    const model = this.getByUid(uid);
    if (model) {
      model.health.rateLimitedUntil = Date.now() + waitTimeMs;
    }
  }

  static markAllPaidAsFailed(reason: string) {
    for (const m of MODEL_REGISTRY) {
      if (m.tier === 'paid') {
        m.status = 'deprecated';
        m.health.lastError = reason;
      }
    }
  }

  /**
   * Resetea la salud de TODOS los modelos.
   * Se invoca cuando hay un blackout total (0 modelos disponibles) para permitir reintento.
   */
  static resetAllHealth(): void {
    for (const m of MODEL_REGISTRY) {
      m.status = 'active';
      m.health.consecutiveErrors = 0;
      m.health.rateLimitedUntil = 0;
      delete m.health.lastError;
    }
  }
}
