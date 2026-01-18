import z from "zod"

export namespace Hook {
  /**
   * Hook execution context shared across all hooks
   */
  export interface Context {
    sessionID: string
    abort?: AbortSignal
    metadata?: Record<string, any>
  }

  /**
   * Pre-tool validation hook input/output
   */
  export namespace PreToolValidate {
    export interface Input {
      tool: string
      sessionID: string
      callID: string
      args: any
    }
    export interface Output {
      args: any
      blocked: boolean
      reason?: string
    }
  }

  /**
   * Post-tool transform hook input/output
   */
  export namespace PostToolTransform {
    export interface Input {
      tool: string
      sessionID: string
      callID: string
    }
    export interface Output {
      title: string
      output: string
      metadata: any
    }
  }

  /**
   * Session stop hook input/output
   */
  export namespace SessionStop {
    export interface Input {
      sessionID: string
      reason: "stop" | "compact" | "error"
    }
    export interface Output {
      metadata: Record<string, any>
    }
  }

  /**
   * Notification hook input/output
   */
  export namespace Notification {
    export interface Input {
      sessionID: string
      type: string
    }
    export interface Output {
      title: string
      body: string
      data: any
    }
  }
}
